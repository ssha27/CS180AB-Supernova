import { useState } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import { useAppStore } from './store/appStore'
import Navbar from './components/Navbar'
import BrowseScreen from './components/BrowseScreen'
import UploadScreen from './components/UploadScreen'
import ViewerScreen from './components/ViewerScreen'
import Toolbar from './components/Toolbar'
import FallbackPopup from './components/FallbackPopup'
import './App.css'

function App() {
  const { is2DFallback, fallbackMessage } = useAppStore()
  const [popupDismissed, setPopupDismissed] = useState(false)
  const location = useLocation()

  const isViewerRoute = location.pathname.startsWith('/viewer')

  return (
    <div className="app">
      {isViewerRoute ? <Toolbar /> : <Navbar />}

      <main className="app-main">
        <Routes>
          <Route path="/" element={<BrowseScreen />} />
          <Route path="/upload" element={<UploadScreen />} />
          <Route path="/viewer/:jobId" element={<ViewerScreen />} />
        </Routes>
      </main>

      {is2DFallback && !popupDismissed && (
        <FallbackPopup
          message={fallbackMessage}
          onDismiss={() => setPopupDismissed(true)}
        />
      )}
    </div>
  )
}

export default App
