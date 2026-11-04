import { registerDiagnostics } from '@browseros/diagnostics/extension'
import { storage } from '@wxt-dev/storage'
import { Capabilities } from '@/lib/browseros/capabilities'
import { createConversationPanelBroker } from '@/lib/browseros/conversationPanelBroker.browser'
import {
  getAgentServerUrl,
  getHealthCheckUrl,
  getMcpServerUrl,
} from '@/lib/browseros/helpers'
import {
  initializeSidePanelOptions,
  openSidePanel,
  prepareTabSidePanel,
  toggleSidePanel,
} from '@/lib/browseros/toggleSidePanel'
import { checkAndShowChangelog } from '@/lib/changelog/changelog-notifier'
import { fetchMcpTools } from '@/lib/mcp/client'
import {
  onRuntimeMessage,
  RuntimeMessageType,
} from '@/lib/messaging/runtime/runtimeMessages'
import { onServerMessage } from '@/lib/messaging/server/serverMessages'
import { onOpenSidePanelWithSearch } from '@/lib/messaging/sidepanel/openSidepanelWithSearch'
import { searchActionsStorage } from '@/lib/search-actions/searchActionsStorage'
import { selectedTextStorage } from '@/lib/selected-text/selectedTextStorage'
import { stopAgentStorage } from '@/lib/stop-agent/stop-agent-storage'
import { scheduledJobRuns } from './scheduledJobRuns'

const GUIDE_CONTEXT_MENU_ID = 'dojo-guide-ask'

/** Panel URL that lands on the guide route for one owning tab. */
const guidePanelPath = (tabId: number) =>
  `sidepanel.html?tabId=${tabId}#/guide`

const registerGuideContextMenu = () => {
  chrome.contextMenus.create({
    id: GUIDE_CONTEXT_MENU_ID,
    title: 'Ask Dojo Guide',
    contexts: ['selection'],
  })
}

const RETIRED_STORAGE_KEYS = [
  // The unshipped Tool Approvals feature.
  'local:tool-approval-config',
  'local:pending-tool-approvals',
  'local:approval-responses',
  'local:tool-execution-log',
  // Mirrored the selected chat target, which the server now holds alone.
  'local:sidepanel-chat-target-selection',
] as const

/** Drops state belonging to features that no longer read it. */
const cleanupRetiredStorage = async () => {
  await storage.removeItems([...RETIRED_STORAGE_KEYS])
}

export default defineBackground(() => {
  registerDiagnostics('browseros', getAgentServerUrl)
  // One background broker owns the long-lived server subscription and all
  // panel-routing effects; individual React panels can come and go freely.
  const conversationPanelBroker = createConversationPanelBroker()
  void conversationPanelBroker.start()

  // Registration never opens a panel. Per-tab URLs let panels opened by the
  // native Alt+A shortcut identify their owner without following tab switches.
  const preparePanel = (tabId: number) => {
    void prepareTabSidePanel(tabId).catch(() => undefined)
  }
  void initializeSidePanelOptions()
    .then(async () => {
      for (const tab of await chrome.tabs.query({})) {
        if (tab.id !== undefined) preparePanel(tab.id)
      }
    })
    .catch(() => undefined)
  chrome.tabs.onCreated.addListener((tab) => {
    if (tab.id !== undefined) preparePanel(tab.id)
  })

  Capabilities.initialize().catch(() => null)

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (
      info.menuItemId !== GUIDE_CONTEXT_MENU_ID ||
      typeof tab?.id !== 'number' ||
      typeof tab.windowId !== 'number'
    ) {
      return
    }
    const target = { tabId: tab.id, windowId: tab.windowId }
    // Register ownership first, then point the tab's panel at the guide
    // route: openSidePanel would re-prepare the default chat path, so the
    // guide path is set after preparation and the panel opened directly.
    void prepareTabSidePanel(target.tabId)
      .then(() =>
        chrome.sidePanel.setOptions({
          tabId: target.tabId,
          path: guidePanelPath(target.tabId),
          enabled: true,
        }),
      )
      .then(() =>
        chrome.sidePanel.browserosToggle({ tabId: target.tabId, open: true }),
      )
      .catch(() => undefined)
  })

  scheduledJobRuns()

  chrome.action.onClicked.addListener(async (tab) => {
    if (typeof tab.id === 'number' && typeof tab.windowId === 'number') {
      await toggleSidePanel({ tabId: tab.id, windowId: tab.windowId })
    }
  })

  onOpenSidePanelWithSearch('open', async (messageData) => {
    const currentTabsList = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    })
    const currentTab = currentTabsList?.[0]
    if (
      typeof currentTab?.id === 'number' &&
      typeof currentTab.windowId === 'number'
    ) {
      const { opened } = await openSidePanel({
        tabId: currentTab.id,
        windowId: currentTab.windowId,
      })

      if (opened) {
        setTimeout(() => {
          searchActionsStorage.setValue(messageData.data)
        }, 500)
      }
    }
  })

  chrome.runtime.onInstalled.addListener((details) => {
    registerGuideContextMenu()
    if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
      initializeSidePanelOptions().catch(() => null)
    }

    if (details.reason === chrome.runtime.OnInstalledReason.UPDATE) {
      cleanupRetiredStorage().catch(() => null)
      checkAndShowChangelog().catch(() => null)
    }
  })

  onRuntimeMessage(RuntimeMessageType.getTabId, ({ sender }) => {
    return { tabId: sender.tab?.id }
  })

  onRuntimeMessage(RuntimeMessageType.stopAgent, async ({ data }) => {
    await stopAgentStorage.setValue({
      conversationId: data.conversationId,
      timestamp: Date.now(),
    })
  })

  chrome.tabs.onRemoved.addListener((tabId) => {
    void conversationPanelBroker.removeTab(tabId).catch(() => undefined)
    const key = String(tabId)
    selectedTextStorage.getValue().then((map) => {
      if (map[key]) {
        const { [key]: _, ...rest } = map
        selectedTextStorage.setValue(rest)
      }
    })
  })

  onServerMessage('checkHealth', async () => {
    try {
      const url = await getHealthCheckUrl()
      const response = await fetch(url)
      return { healthy: response.ok }
    } catch {
      return { healthy: false }
    }
  })

  onServerMessage('fetchMcpTools', async () => {
    try {
      const url = await getMcpServerUrl()
      const tools = await fetchMcpTools(url)
      return { tools }
    } catch (err) {
      return {
        tools: [],
        error: err instanceof Error ? err.message : 'Failed to fetch tools',
      }
    }
  })
})
