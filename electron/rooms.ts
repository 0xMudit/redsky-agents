import * as path from 'node:path'
import { JsonStore } from './lib/persist'
import { newId } from './lib/ids'
import { userDataDir } from './paths'
import type { Room } from '../shared/types'

export interface RoomStore {
  list: () => Room[]
  get: (id: string) => Room | undefined
  upsert: (room: Room) => Room
  create: (title: string, participantIds: string[]) => Room
  addParticipant: (roomId: string, botId: string) => Room
  rename: (roomId: string, title: string) => Room
  delete: (roomId: string) => void
  touch: (roomId: string, preview: string) => Room | undefined
}

export function createRoomStore(): RoomStore {
  const db = new JsonStore<Room[]>(path.join(userDataDir(), 'rooms.json'), [])
  let rows = db.read()
  const persist = () => db.write(rows)

  return {
    list: () =>
      // Newest first; break same-millisecond ties by insertion order so two
      // rooms created back-to-back still list most-recent-created first.
      rows
        .map((room, index) => ({ room, index }))
        .sort((a, b) => b.room.updatedAt - a.room.updatedAt || b.index - a.index)
        .map((x) => x.room),
    get: (id) => rows.find((r) => r.id === id),
    upsert(room) {
      const i = rows.findIndex((r) => r.id === room.id)
      if (i >= 0) rows[i] = room
      else rows.push(room)
      persist()
      return room
    },
    create(title, participantIds) {
      const now = Date.now()
      const room: Room = {
        id: newId('room'),
        title: title.trim() || 'Thread',
        participantIds: [...new Set(participantIds.filter(Boolean))],
        preview: '',
        createdAt: now,
        updatedAt: now,
      }
      rows.push(room)
      persist()
      return room
    },
    addParticipant(roomId, botId) {
      const room = rows.find((r) => r.id === roomId)
      if (!room) throw new Error('room not found')
      if (!room.participantIds.includes(botId)) room.participantIds.push(botId)
      room.updatedAt = Date.now()
      persist()
      return room
    },
    rename(roomId, title) {
      const room = rows.find((r) => r.id === roomId)
      if (!room) throw new Error('room not found')
      room.title = title.trim() || room.title
      room.updatedAt = Date.now()
      persist()
      return room
    },
    delete(roomId) {
      rows = rows.filter((r) => r.id !== roomId)
      persist()
    },
    touch(roomId, preview) {
      const room = rows.find((r) => r.id === roomId)
      if (!room) return undefined
      room.preview = preview.slice(0, 140)
      room.updatedAt = Date.now()
      persist()
      return room
    },
  }
}
