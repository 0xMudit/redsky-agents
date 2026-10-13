import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { stripThinking } from '../../shared/visible'

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c])
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

const HASH_LANGS = new Set(['py', 'python', 'sh', 'bash', 'zsh', 'shell', 'console', 'yaml', 'yml', 'toml', 'ini', 'conf', 'rb', 'ruby', 'perl', 'r', 'ps1', 'powershell'])
const CLANG_LANGS = new Set([
  'js', 'javascript', 'jsx', 'ts', 'typescript', 'tsx', 'json', 'jsonc', 'java', 'c', 'h', 'cpp', 'cc', 'hpp', 'cs', 'csharp',
  'go', 'golang', 'rs', 'rust', 'kt', 'kotlin', 'swift', 'php', 'scala', 'dart', 'css', 'scss', 'less', 'sql', 'graphql', 'gql',
])
const KW_C = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
  'new', 'class', 'extends', 'implements', 'super', 'this', 'import', 'from', 'export', 'default', 'async', 'await', 'try',
  'catch', 'finally', 'throw', 'typeof', 'instanceof', 'void', 'delete', 'in', 'of', 'yield', 'static', 'public', 'private',
  'protected', 'readonly', 'interface', 'type', 'enum', 'package', 'struct', 'impl', 'fn', 'mut', 'pub', 'use', 'match',
  'where', 'func', 'defer', 'chan', 'range', 'select', 'go', 'package', 'namespace', 'abstract', 'final', 'override',
  'true', 'false', 'null', 'undefined', 'nil', 'none', 'some', 'ok', 'and', 'or', 'not',
])
const KW_HASH = new Set([
  'def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'in', 'not', 'and', 'or', 'is', 'with', 'as', 'lambda',
  'yield', 'import', 'from', 'try', 'except', 'finally', 'raise', 'pass', 'global', 'nonlocal', 'assert', 'del', 'async',
  'await', 'print', 'self', 'none', 'true', 'false', 'function', 'local', 'then', 'fi', 'done', 'esac', 'export', 'source',
])

type TokenRule = { cls: string; re: RegExp }

function buildRules(kind: 'hash' | 'c'): TokenRule[] {
  const kw = kind === 'hash' ? KW_HASH : KW_C
  const kwAlt = [...kw].map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  if (kind === 'hash') {
    return [
      { cls: 'comment', re: /#[^\n]*/y },
      { cls: 'str', re: /"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/y },
      { cls: 'num', re: /\b\d[\d._]*\b/y },
      { cls: 'kw', re: new RegExp(`\\b(?:${kwAlt})\\b`, 'y') },
      { cls: 'fn', re: /[A-Za-z_][\w]*(?=\s*\()/y },
    ]
  }
  return [
    { cls: 'comment', re: /\/\/[^\n]*|\/\*[\s\S]*?\*\//y },
    { cls: 'str', re: /`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/y },
    { cls: 'num', re: /\b0x[\da-fA-F]+\b|\b\d[\d._]*\b/y },
    { cls: 'kw', re: new RegExp(`\\b(?:${kwAlt})\\b`, 'y') },
    { cls: 'fn', re: /[A-Za-z_$][\w$]*(?=\s*\()/y },
  ]
}

function highlight(code: string, lang: string): string {
  const kind: 'hash' | 'c' | null = HASH_LANGS.has(lang) ? 'hash' : CLANG_LANGS.has(lang) ? 'c' : null
  if (!kind) return escapeHtml(code)
  const rules = buildRules(kind)
  let out = ''
  let i = 0
  while (i < code.length) {
    let matched = false
    for (const rule of rules) {
      rule.re.lastIndex = i
      const m = rule.re.exec(code)
      if (m && m.index === i && m[0].length) {
        out += `<span class="tok-${rule.cls}">${escapeHtml(m[0])}</span>`
        i += m[0].length
        matched = true
        break
      }
    }
    if (!matched) {
      out += escapeHtml(code[i])
      i += 1
    }
  }
  return out
}

function enhanceCodeBlocks(html: string): string {
  return html.replace(/<pre><code([^>]*)>([\s\S]*?)<\/code><\/pre>/g, (_full, attrs: string, body: string) => {
    const langMatch = /class="language-([^"]+)"/.exec(attrs)
    const lang = (langMatch?.[1] ?? '').toLowerCase()
    const code = decodeEntities(body)
    const bar =
      `<div class="code-bar"><span class="code-lang">${escapeHtml(lang || 'code')}</span>` +
      `<span class="code-copy" role="button" tabindex="0">Copy</span></div>`
    return `<div class="code-wrap">${bar}<pre><code>${highlight(code, lang)}</code></pre></div>`
  })
}

export function renderMarkdown(text: string): string {
  const raw = marked.parse(stripThinking(text || ''), { async: false }) as string
  const clean = DOMPurify.sanitize(raw)
  return enhanceCodeBlocks(clean)
}

export function timeLabel(ts: number): string {
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function dateLabel(ts: number): string {
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export { stripThinking }
