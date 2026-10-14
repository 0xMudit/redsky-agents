import React, { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export interface ConfirmOptions {
  title: string
  body?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

interface Request {
  options: ConfirmOptions
  kind: 'confirm' | 'alert'
  resolve: (value: boolean) => void
}

let opener: ((req: Request) => void) | null = null

/**
 * Themed replacement for `window.confirm`. Resolves `true` when confirmed.
 * Falls back to the native dialog if the host has not mounted yet.
 */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  if (!opener) return Promise.resolve(window.confirm(`${options.title}${options.body ? `\n\n${options.body}` : ''}`))
  return new Promise((resolve) => opener!({ options, kind: 'confirm', resolve }))
}

/**
 * Themed replacement for `window.alert`. Resolves once acknowledged.
 */
export function alertDialog(options: Omit<ConfirmOptions, 'cancelLabel'>): Promise<void> {
  if (!opener) {
    window.alert(`${options.title}${options.body ? `\n\n${options.body}` : ''}`)
    return Promise.resolve()
  }
  return new Promise((resolve) => opener!({ options, kind: 'alert', resolve: () => resolve() }))
}

/** Mount once near the app root to power `confirmDialog` / `alertDialog`. */
export function ConfirmHost(): React.JSX.Element | null {
  const [req, setReq] = useState<Request | null>(null)

  useEffect(() => {
    opener = setReq
    return () => {
      opener = null
    }
  }, [])

  if (!req) return null

  const { options, kind } = req
  const close = (value: boolean): void => {
    req.resolve(value)
    setReq(null)
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) close(kind === 'alert') }}>
      <DialogContent className="w-[380px] max-w-[calc(100%-2rem)] gap-4">
        <DialogHeader>
          <DialogTitle>{options.title}</DialogTitle>
          {options.body ? <DialogDescription>{options.body}</DialogDescription> : null}
        </DialogHeader>
        <DialogFooter className="mt-1 gap-2">
          {kind === 'confirm' ? (
            <Button
              variant="outline"
              className="h-auto rounded-full px-3.5 py-1.5 text-[13px] pressable"
              onClick={() => close(false)}
            >
              {options.cancelLabel ?? 'Cancel'}
            </Button>
          ) : null}
          <Button
            variant={options.danger ? 'destructive' : 'default'}
            className="h-auto rounded-full px-3.5 py-1.5 text-[13px] pressable"
            onClick={() => close(true)}
            autoFocus
          >
            {options.confirmLabel ?? 'OK'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
