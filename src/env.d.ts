interface Window {
  moseq: {
    openDirectory: () => Promise<string | null>
    getBackendPort: () => Promise<number>
  }
}
