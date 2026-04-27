import { Routes, Route } from 'react-router-dom';
import UploadPage from './pages/UploadPage';
import LoadingPage from './pages/LoadingPage';
import ViewerPage from './pages/ViewerPage';

function App() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <Routes>
        <Route path="/" element={<UploadPage />} />
        <Route path="/processing/:jobId" element={<LoadingPage />} />
        <Route path="/viewer/:jobId" element={<ViewerPage />} />
      </Routes>
    </div>
  );
}

export default App;
