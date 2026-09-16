interface SecureStorageCapabilities {
  isEncryptionAvailable: () => boolean
  getSelectedStorageBackend?: () => string
}

export function canPersistTelegramSession(storage: SecureStorageCapabilities): boolean {
  if (!storage.isEncryptionAvailable()) return false
  return typeof storage.getSelectedStorageBackend !== 'function' || storage.getSelectedStorageBackend() !== 'basic_text'
}
