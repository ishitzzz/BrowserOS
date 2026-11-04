import { defineExtensionMessaging } from '@webext-core/messaging'

export const RuntimeMessageType = {
  getTabId: 'runtime.getTabId',
  stopAgent: 'runtime.stopAgent',
  guideDrawMark: 'runtime.guideDrawMark',
  guideClearMarks: 'runtime.guideClearMarks',
  guideGetLiveSelection: 'runtime.guideGetLiveSelection',
} as const

export interface RuntimeTabIdResponse {
  tabId?: number
}

export interface RuntimeStopAgentData {
  conversationId: string
}

export type GuideMarkStyle = 'highlight' | 'box' | 'underline' | 'circle'

export interface GuideDrawMarkData {
  style: GuideMarkStyle
  selectionId: number
}

export interface GuideDrawMarkResult {
  ok: boolean
  reason?: 'no-selection' | 'stale-range' | 'selection-changed'
}

type RuntimeMessagesProtocol = {
  [RuntimeMessageType.getTabId](): RuntimeTabIdResponse
  [RuntimeMessageType.stopAgent](data: RuntimeStopAgentData): void
  [RuntimeMessageType.guideDrawMark](
    data: GuideDrawMarkData,
  ): GuideDrawMarkResult
  [RuntimeMessageType.guideClearMarks](): void
  [RuntimeMessageType.guideGetLiveSelection](): {
    text: string
    selectionId: number
  } | null
}

const { sendMessage, onMessage } =
  defineExtensionMessaging<RuntimeMessagesProtocol>()

export { onMessage as onRuntimeMessage, sendMessage as sendRuntimeMessage }
