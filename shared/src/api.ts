export const API = "/api";
export const paths = {
  projects: `${API}/projects`,
  project: (id: string) => `${API}/projects/${id}`,
  scan: (id: string) => `${API}/projects/${id}/scan`,
  specs: `${API}/specs`,
  advance: (id: string) => `${API}/specs/${id}/advance`,
  spec: (id: string) => `${API}/specs/${id}`,
  triggers: `${API}/triggers`,
  toggle: (id: string) => `${API}/triggers/${id}/toggle`,
  settings: `${API}/settings`,
  runs: `${API}/runs`,
  run: (id: string) => `${API}/runs/${id}`,
  docs: (id: string) => `${API}/projects/${id}/docs`,
  docFile: (id: string, path: string) => `${API}/projects/${id}/docs/${path}`,
  fsBrowse: (path?: string) => `${API}/fs/browse${path ? `?path=${encodeURIComponent(path)}` : ""}`,
} as const;
