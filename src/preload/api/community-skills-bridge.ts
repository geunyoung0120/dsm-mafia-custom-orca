import { ipcRenderer } from 'electron'
import type { CommunitySkillsApi } from '../../shared/community-skills'

export const communitySkillsApi: CommunitySkillsApi = {
  status: () => ipcRenderer.invoke('community-skills:status'),
  search: (input) => ipcRenderer.invoke('community-skills:search', input),
  readVersion: (input) => ipcRenderer.invoke('community-skills:readVersion', input),
  register: (input) => ipcRenderer.invoke('community-skills:register', input),
  login: (input) => ipcRenderer.invoke('community-skills:login', input),
  logout: () => ipcRenderer.invoke('community-skills:logout'),
  publish: (input) => ipcRenderer.invoke('community-skills:publish', input),
  hide: (input) => ipcRenderer.invoke('community-skills:hide', input),
  report: (input) => ipcRenderer.invoke('community-skills:report', input)
}
