import { useState } from 'react'
import { useAppStore, UPLOAD_STATES } from './store/appStore'
import UploadScreen from './components/UploadScreen'
import ViewerScreen from './components/ViewerScreen'
import Toolbar from './components/Toolbar'
import OrganSidebar from './components/OrganSidebar'
import FallbackPopup from './components/FallbackPopup'
import './App.css'

function App() {
  const { uploadState, is2DFallback, fallbackMessage } = useAppStore()
  const [popupDismissed, setPopupDismissed] = useState(false)

  const isViewing =
    uploadState === UPLOAD_STATES.VIEWING || uploadState === UPLOAD_STATES.READY

  return (
    <div className="app">
      <Toolbar />
      <OrganSidebar />

      <main className="app-main">
        {isViewing ? <ViewerScreen /> : <UploadScreen />}
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
