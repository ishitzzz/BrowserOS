import {
  RuntimeMessageType,
  sendRuntimeMessage,
} from '@/lib/messaging/runtime/runtimeMessages'
import { selectedTextStorage } from '@/lib/selected-text/selectedTextStorage'

const MAX_SELECTED_TEXT_LENGTH = 5000

export default defineContentScript({
  matches: ['*://*/*'],
  runAt: 'document_idle',
  async main() {
    const response = await sendRuntimeMessage(RuntimeMessageType.getTabId)
    const tabId: number | undefined = response?.tabId
    if (!tabId) return

    const key = String(tabId)

    document.addEventListener('mouseup', () => {
      const text = window.getSelection()?.toString().trim()

      if (text && text.length > 0) {
        selectedTextStorage.getValue().then((map) => {
          selectedTextStorage.setValue({
            ...map,
            [key]: {
              text: text.slice(0, MAX_SELECTED_TEXT_LENGTH),
              pageUrl: window.location.href,
              pageTitle: document.title,
              tabId,
              timestamp: Date.now(),
            },
          })
        })
      } else {
        selectedTextStorage.getValue().then((map) => {
          if (map[key]) {
            const { [key]: _, ...rest } = map
            selectedTextStorage.setValue(rest)
          }
        })
      }
    })
  },
})

/**
 * Selection tooltip (dojo-live-search UX parity): an "Explain this" button at the
 * selection and an image hover tooltip. The tooltip only dispatches window events;
 * the host environment (the Dojo Guide Electron app, or a Chrome sidePanel opener)
 * turns them into a panel ask. Kept behavior-identical to the dist patch the app
 * applies (app/scripts/browseros-guide-tooltip-patch.mjs) until a CI bundle ships.
 */
;(() => {
  if ((window as any).__dojoGuideTooltip) return
  ;(window as any).__dojoGuideTooltip = true
  let tip: HTMLElement | null = null
  const hide = () => { if (tip) { tip.remove(); tip = null } }
  const mkBtn = (label: string, primary: boolean) => {
    const b = document.createElement('button')
    b.textContent = label
    b.style.cssText = 'cursor:pointer;border:0;border-radius:8px;padding:7px 14px;font:600 13px Arial;box-shadow:0 2px 8px rgba(0,0,0,.3);'
      + (primary ? 'background:#f28c0f;color:#fff;' : 'background:#fff;color:#c75b00;border:2px solid #f28c0f;')
    b.onmousedown = (e) => e.preventDefault()
    return b
  }
  const showAt = (x: number, y: number, buttons: HTMLButtonElement[]) => {
    hide()
    tip = document.createElement('div')
    tip.id = 'dojo-guide-tooltip'
    tip.style.cssText = 'position:fixed;z-index:2147483647;display:flex;gap:8px;left:'
      + Math.min(Math.max(8, x), innerWidth - 300) + 'px;top:' + Math.min(y, innerHeight - 44) + 'px;'
    for (const b of buttons) tip.appendChild(b)
    document.documentElement.appendChild(tip)
  }
  document.addEventListener('mouseup', (ev) => {
    if ((ev.target as HTMLElement).closest && (ev.target as HTMLElement).closest('#dojo-guide-tooltip,[data-dojo-guide-marks]')) return
    setTimeout(() => {
      const sel = getSelection()
      const txt = sel ? sel.toString().trim() : ''
      hide()
      if (txt.length < 8 || !sel || !sel.rangeCount) return
      const r = sel.getRangeAt(0).getBoundingClientRect()
      const explain = mkBtn('Explain this', true)
      explain.onclick = () => { window.dispatchEvent(new CustomEvent('dojo-guide:explain-selection', { detail: { text: txt.slice(0, 500) } })); hide() }
      const ask = mkBtn('Ask in panel', false)
      ask.onclick = () => { window.dispatchEvent(new Event('dojo-guide:focus-ask')); hide() }
      showAt(r.left, r.bottom + 8, [explain, ask])
    }, 10)
  })
  document.addEventListener('mousedown', (ev) => {
    if (tip && !(ev.target as HTMLElement).closest?.('#dojo-guide-tooltip')) hide()
  })
  let hoverTimer = 0
  document.addEventListener('mouseover', (ev) => {
    const img = (ev.target as HTMLElement).tagName === 'IMG' ? (ev.target as HTMLImageElement) : null
    window.clearTimeout(hoverTimer)
    if (!img) return
    const r = img.getBoundingClientRect()
    if (r.width < 120 || r.height < 80) return
    hoverTimer = window.setTimeout(() => {
      const rr = img.getBoundingClientRect()
      const b = mkBtn('Explain this image', true)
      b.onclick = () => {
        window.dispatchEvent(new CustomEvent('dojo-guide:explain-image', { detail: { alt: img.alt || '', src: img.currentSrc || img.src || '' } }))
        hide()
      }
      showAt(rr.left + 8, rr.top + 8, [b])
    }, 800)
  })
  document.addEventListener('mouseout', (ev) => {
    if ((ev.target as HTMLElement).tagName === 'IMG') window.clearTimeout(hoverTimer)
  })
})()
