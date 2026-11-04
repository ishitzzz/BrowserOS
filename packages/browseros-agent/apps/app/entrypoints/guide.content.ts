import {
  type GuideDrawMarkResult,
  onRuntimeMessage,
  RuntimeMessageType,
} from '@/lib/messaging/runtime/runtimeMessages'

type GuideMarkStyle = 'highlight' | 'box' | 'underline' | 'circle'

const GUIDE_COLORS: Record<GuideMarkStyle, string> = {
  highlight: 'rgba(139, 92, 246, 0.32)', // violet: guide question/explanation
  box: 'rgba(255, 123, 114, 0.9)', // coral: warning
  underline: 'rgba(56, 189, 248, 0.95)', // sky: definition
  circle: 'rgba(139, 92, 246, 0.9)',
}

const MARK_ROOT_ATTR = 'data-dojo-guide-marks'
const CHIP_ID = 'dojo-guide-mark-chip'

/**
 * The exact selection the user made, kept as a live Range clone so a later
 * mark lands on the same nodes even after the visible selection collapses
 * (clicking the side panel collapses it). Multi-line selections stay intact:
 * we never re-derive text, we keep the Range itself.
 */
let savedRange: Range | null = null
let savedText = ''
let selectionId = 0
let lastMarkStyle: GuideMarkStyle = 'highlight'

const captureSelection = () => {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return
  }
  const range = selection.getRangeAt(0)
  const text = selection.toString()
  if (!text?.trim()) return
  try {
    if (
      !savedRange ||
      savedRange.startContainer !== range.startContainer ||
      savedRange.startOffset !== range.startOffset ||
      savedRange.endContainer !== range.endContainer ||
      savedRange.endOffset !== range.endOffset ||
      savedText !== text
    ) {
      selectionId += 1
    }
    savedRange = range.cloneRange()
    savedText = text
  } catch {
    savedRange = null
    savedText = ''
  }
}

let captureTimer: number | undefined
const onSelectionChange = () => {
  window.clearTimeout(captureTimer)
  captureTimer = window.setTimeout(captureSelection, 120)
}

const clearMarks = () => {
  document.querySelectorAll(`[${MARK_ROOT_ATTR}]`).forEach((node) => {
    node.remove()
  })
}

const rectForRange = (range: Range): DOMRect[] => {
  // getClientRects gives one rect per line box, which is what makes multi-line
  // highlights exact. Zero-size rects (whitespace joins) are dropped.
  return Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 1 && rect.height > 1,
  )
}

const drawMark = (
  style: GuideMarkStyle,
  expectedSelectionId = selectionId,
): GuideDrawMarkResult => {
  lastMarkStyle = style
  if (!savedRange || !savedText) {
    return { ok: false, reason: 'no-selection' }
  }
  captureSelection()
  if (selectionId !== expectedSelectionId) {
    return { ok: false, reason: 'selection-changed' }
  }
  if (
    !savedRange.startContainer.isConnected ||
    !savedRange.endContainer.isConnected ||
    savedRange.toString() !== savedText
  ) {
    return { ok: false, reason: 'stale-range' }
  }
  let rects: DOMRect[]
  try {
    rects = rectForRange(savedRange)
  } catch {
    savedRange = null
    savedText = ''
    return { ok: false, reason: 'stale-range' }
  }
  if (rects.length === 0) {
    return { ok: false, reason: 'stale-range' }
  }

  clearMarks()

  const root = document.createElement('div')
  root.setAttribute(MARK_ROOT_ATTR, 'true')
  const shadow = root.attachShadow({ mode: 'open' })

  const color = GUIDE_COLORS[style]
  const scrollX = window.scrollX
  const scrollY = window.scrollY

  const container = document.createElement('div')
  container.style.cssText =
    'position:absolute;left:0;top:0;width:0;height:0;z-index:2147483646;pointer-events:none;'
  shadow.appendChild(container)

  for (const rect of rects) {
    const el = document.createElement('div')
    const pad = style === 'circle' || style === 'box' ? 3 : 0
    const base = `position:absolute;left:${rect.left + scrollX - pad}px;top:${rect.top + scrollY - pad}px;width:${rect.width + pad * 2}px;height:${rect.height + pad * 2}px;pointer-events:none;`
    if (style === 'highlight') {
      el.style.cssText = `${base}background:${color};border-radius:2px;mix-blend-mode:multiply;`
    } else if (style === 'underline') {
      el.style.cssText = `${base}border-bottom:2px solid ${color};`
    } else if (style === 'box') {
      el.style.cssText = `${base}border:2px solid ${color};border-radius:3px;`
    } else {
      el.style.cssText = `${base}border:2px solid ${color};border-radius:9999px;`
    }
    container.appendChild(el)
  }

  const chip = document.createElement('div')
  const first = rects[0]
  chip.id = CHIP_ID
  chip.style.cssText = `position:absolute;left:${first.left + scrollX}px;top:${first.top + scrollY - 22}px;background:#8b5cf6;color:#fff;font:11px/16px system-ui,sans-serif;padding:2px 8px;border-radius:9999px;pointer-events:none;white-space:nowrap;`
  chip.textContent = 'Guide'
  container.appendChild(chip)

  document.documentElement.appendChild(root)
  return { ok: true }
}

export default defineContentScript({
  matches: ['*://*/*'],
  runAt: 'document_idle',
  main() {
    document.addEventListener('selectionchange', onSelectionChange)

    onRuntimeMessage(RuntimeMessageType.guideDrawMark, ({ data }) => {
      return drawMark(data.style, data.selectionId)
    })

    onRuntimeMessage(RuntimeMessageType.guideClearMarks, () => {
      clearMarks()
    })

    onRuntimeMessage(RuntimeMessageType.guideGetLiveSelection, () => {
      captureSelection()
      return savedText ? { text: savedText, selectionId } : null
    })

    // Marks follow the page while its Range stays valid; once the DOM moves
    // under them they are dropped rather than drawn in the wrong place.
    const reposition = () => {
      const root = document.querySelector(`[${MARK_ROOT_ATTR}]`)
      if (!root || !savedRange) return
      drawMark(lastMarkStyle)
    }
    let repositionTimer: number | undefined
    const scheduleReposition = () => {
      window.clearTimeout(repositionTimer)
      repositionTimer = window.setTimeout(reposition, 100)
    }
    window.addEventListener('scroll', scheduleReposition, true)
    window.addEventListener('resize', scheduleReposition)
  },
})
