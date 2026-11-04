import { Loader2, MousePointer2, RefreshCw, Sparkles } from 'lucide-react'
import { type FC, useEffect, useRef, useState } from 'react'
import { resolvePanelTabId } from '@/lib/browseros/panelTab'
import {
  RuntimeMessageType,
  sendRuntimeMessage,
} from '@/lib/messaging/runtime/runtimeMessages'
import {
  type SelectedTextData,
  selectedTextStorage,
} from '@/lib/selected-text/selectedTextStorage'
import { useChatSessionContext } from '@/modules/chat/chat-session-context'

const getMessageText = (message: {
  parts: Array<{ type: string; text?: string }>
}) =>
  message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('')

/**
 * Dojo Guide surface: select text on the page, ask about it, and the guide
 * explains - then marks the exact selected range on the original tab. The
 * amber card is only a preview of what you selected; the guide's explanation
 * is the streamed answer below it. A mark is drawn only after a completed,
 * error-free answer, never on failure.
 */
export const Guide: FC = () => {
  const { messages, sendMessage, status, chatError, retryLastTurn, canSend } =
    useChatSessionContext()

  const [panelTabId, setPanelTabId] = useState<number | undefined>(undefined)
  const [selection, setSelection] = useState<SelectedTextData | null>(null)
  const [input, setInput] = useState('')
  const [markState, setMarkState] = useState<
    'idle' | 'drawn' | 'failed' | 'no-selection' | 'stale-range'
  >('idle')
  const bottomRef = useRef<HTMLDivElement>(null)

  // This panel belongs to one tab; its selection preview comes from that tab,
  // and marks go back to the tab the selection was made in - never whichever
  // tab happens to be active when the answer lands.
  useEffect(() => {
    void resolvePanelTabId().then(setPanelTabId)
  }, [])

  useEffect(() => {
    if (panelTabId === undefined) return
    const key = String(panelTabId)
    selectedTextStorage.getValue().then((map) => {
      setSelection(map[key] ?? null)
    })
    const unwatch = selectedTextStorage.watch((map) => {
      setSelection(map[key] ?? null)
    })
    return () => unwatch()
  }, [panelTabId])

  // Draw on the page only when a turn completed cleanly with an answer.
  const previousStatusRef = useRef(status)
  useEffect(() => {
    const wasBusy =
      previousStatusRef.current === 'streaming' ||
      previousStatusRef.current === 'submitted'
    previousStatusRef.current = status
    if (!wasBusy || status !== 'ready' || chatError) return
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'assistant' || !getMessageText(last).trim()) {
      return
    }
    const targetTabId = selection?.tabId ?? panelTabId
    if (targetTabId === undefined) return
    sendRuntimeMessage(
      RuntimeMessageType.guideDrawMark,
      { style: 'highlight' },
      targetTabId,
    )
      .then((result) => {
        setMarkState(result?.ok ? 'drawn' : (result?.reason ?? 'failed'))
      })
      .catch(() => setMarkState('failed'))
    // Only the completion edge matters; selection identity is read at that
    // moment so a newer selection never gets an older answer's mark.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, status])

  const handleAsk = () => {
    const text = input.trim()
    if (!text) return
    const sent = sendMessage({ text })
    if (sent) {
      setInput('')
      setMarkState('idle')
    }
  }

  const busy = status === 'submitted' || status === 'streaming'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b px-3 py-2">
        <div className="flex items-center gap-2 font-medium text-sm">
          <Sparkles className="h-4 w-4 text-[#8b5cf6]" />
          Dojo Guide
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {selection ? (
          <div className="mb-3 rounded-lg border border-[var(--accent-orange)]/40 bg-accent/20 p-2.5">
            <div className="mb-1 font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
              Selection preview - not an answer yet
            </div>
            <div className="mb-0.5 truncate text-[10px] text-muted-foreground">
              {selection.pageTitle}
            </div>
            <div className="line-clamp-4 text-foreground text-xs leading-relaxed">
              &ldquo;
              {selection.text.length > 280
                ? `${selection.text.slice(0, 280)}...`
                : selection.text}
              &rdquo;
            </div>
          </div>
        ) : (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-dashed p-2.5 text-muted-foreground text-xs">
            <MousePointer2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            Select text on the page, then ask about it here. Right-click also
            works: &quot;Ask Dojo Guide&quot;.
          </div>
        )}

        {messages.map((message) => {
          const text = getMessageText(message)
          if (!text.trim()) return null
          const isUser = message.role === 'user'
          return (
            <div
              key={message.id}
              className={`mb-2 rounded-lg p-2.5 text-xs leading-relaxed ${
                isUser
                  ? 'ml-6 bg-primary/10'
                  : 'mr-2 border border-[#8b5cf6]/30 bg-[#8b5cf6]/5'
              }`}
            >
              <div className="mb-1 font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
                {isUser ? 'You' : 'Guide explanation'}
              </div>
              <div className="whitespace-pre-wrap">{text}</div>
            </div>
          )
        })}

        {busy && (
          <div className="mb-2 flex items-center gap-2 text-muted-foreground text-xs">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Guide is thinking...
          </div>
        )}

        {chatError && !busy && (
          <div className="mb-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-xs">
            <div className="mb-1">
              The guide could not answer:{' '}
              {chatError.message || 'something went wrong'}. Nothing was marked
              on the page.
            </div>
            <button
              type="button"
              onClick={() => retryLastTurn()}
              className="inline-flex items-center gap-1 rounded border px-2 py-1 font-medium hover:bg-background"
            >
              <RefreshCw className="h-3 w-3" />
              Try again
            </button>
          </div>
        )}

        {markState === 'drawn' && (
          <div className="mb-2 text-[11px] text-muted-foreground">
            Marked your selection on the page in violet.
          </div>
        )}
        {(markState === 'failed' ||
          markState === 'no-selection' ||
          markState === 'stale-range') && (
          <div className="mb-2 text-[11px] text-muted-foreground">
            Could not mark the page - the selection is no longer available
            there. The answer above still stands.
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                handleAsk()
              }
            }}
            placeholder={
              selection
                ? 'Ask the guide about your selection...'
                : 'Ask the guide...'
            }
            rows={2}
            className="min-h-[40px] flex-1 resize-none rounded-lg border bg-background px-2.5 py-2 text-xs outline-none focus:border-[#8b5cf6]/60"
          />
          <button
            type="button"
            onClick={handleAsk}
            disabled={busy || !input.trim() || !canSend}
            className="rounded-lg bg-[#8b5cf6] px-3 py-2 font-medium text-white text-xs disabled:opacity-40"
          >
            Ask
          </button>
        </div>
        {!canSend && (
          <div className="mt-1.5 text-[11px] text-muted-foreground">
            Connect a model provider in settings before asking.
          </div>
        )}
      </div>
    </div>
  )
}
