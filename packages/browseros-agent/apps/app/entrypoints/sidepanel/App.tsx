import type { FC } from 'react'
import { HashRouter, Route, Routes } from 'react-router'
import { ChatLayout } from '@/components/layout/ChatLayout'
import { ChatHistory } from '@/screens/sidepanel/history/ChatHistory'
import { Guide } from '@/screens/sidepanel/guide/Guide'
import { Chat } from '@/screens/sidepanel/index/Chat'

export const App: FC = () => {
  return (
    <HashRouter>
      <Routes>
        <Route element={<ChatLayout />}>
          <Route index element={<Chat />} />
          <Route path="history" element={<ChatHistory />} />
          <Route path="guide" element={<Guide />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
