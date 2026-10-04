# Independent community skills navigation

**Goal:** Show 공유 스킬 directly in the left sidebar without enabling any setting.
**Architecture:** Move the existing catalog entry from SkillsPageHeader to SidebarNav. Reuse the existing catalog dialog and API; the original local Skills shortcut and link sharing remain separate.
**Validation:** The actual SidebarNav must open and close the catalog with showSkillsButton=false. Existing catalog preview, authentication, publishing, and moderation tests continue to pass. Check Korean/English labels, light/dark layouts, web types, and a hidden Electron render.
**Delivery:** Build and verify a fresh personal candidate without replacing the running app. Prepare installation on exit, refresh the trusted feature patch, push the distribution, verify four-platform GitHub release, and reconcile publication metadata.
