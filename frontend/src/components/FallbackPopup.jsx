import './FallbackPopup.css'

export default function FallbackPopup({ message, onDismiss }) {
  if (!message) return null

  return (
    <div className="fallback-popup">
      <div className="fallback-popup-content">
        <span className="fallback-icon">ℹ️</span>
        <p>{message}</p>
        <button className="fallback-dismiss" onClick={onDismiss}>
          ✕
        </button>
      </div>
    </div>
  )
}
