import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import {
  Activity, ArrowDown, ArrowRight, Blocks, BookOpen, CalendarClock, Check, CheckCheck,
  CircleHelp, Clock3, FileText, Files, FolderOpen, History, Home, Inbox, LoaderCircle,
  ListTodo, LockKeyhole, Menu, MessageSquare, Mic, MoreHorizontal, PanelLeftClose, PanelLeftOpen,
  PanelRight, Paperclip, Plus, Search, Send, Settings2, ShieldCheck, Sparkles, SquarePen, Trash2, X,
} from 'lucide-react'
import { api } from './api'
import type { AuditEvent, ForgeTask, MemoryEntry, Plan } from './types'
import './App.css'
import './feature.css'

type Section = 'home' | 'chat' | 'inbox' | 'projects' | 'automations' | 'memory' | 'connected' | 'files' | 'history' | 'settings'
type HistoryTab = 'plans' | 'tasks' | 'activity'
type Toast = { id: number; text: string; kind: 'success' | 'error' }

const navigation: Array<{ id: Exclude<Section, 'chat'>; label: string; icon: typeof MessageSquare }> = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'inbox', label: 'Inbox', icon: Inbox },
  { id: 'projects', label: 'Projects', icon: FolderOpen },
  { id: 'automations', label: 'Automations', icon: CalendarClock },
  { id: 'memory', label: 'Memory', icon: BookOpen },
  { id: 'connected', label: 'Connected Apps', icon: Blocks },
  { id: 'files', label: 'Files', icon: Files },
  { id: 'history', label: 'Task history', icon: History },
  { id: 'settings', label: 'Settings', icon: Settings2 },
]

const quickStarts = [
  'Break my top priority this week into small next steps',
  'Turn my meeting notes into a clear project checklist',
  'Plan a simple launch timeline with tasks I can review',
]

function formatDate(value: string) {
  return new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function trapDrawerTab(event: globalThis.KeyboardEvent, drawer: HTMLElement | null) {
  if (event.key !== 'Tab' || !drawer) return
  const focusable = Array.from(drawer.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'))
    .filter((element) => element.getClientRects().length > 0)
  if (!focusable.length) {
    event.preventDefault()
    drawer.focus()
    return
  }
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && (document.activeElement === first || !drawer.contains(document.activeElement))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (document.activeElement === last || !drawer.contains(document.activeElement))) {
    event.preventDefault()
    first.focus()
  }
}

function App() {
  const [section, setSection] = useState<Section>('home')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [desktopNavCollapsed, setDesktopNavCollapsed] = useState(false)
  const [mobileContextOpen, setMobileContextOpen] = useState(false)
  const [historyTab, setHistoryTab] = useState<HistoryTab>('plans')
  const [plans, setPlans] = useState<Plan[]>([])
  const [currentPlanId, setCurrentPlanId] = useState('')
  const [dirtyPlanIds, setDirtyPlanIds] = useState<Set<string>>(() => new Set())
  const [tasks, setTasks] = useState<ForgeTask[]>([])
  const [memories, setMemories] = useState<MemoryEntry[]>([])
  const [activity, setActivity] = useState<AuditEvent[]>([])
  const [draft, setDraft] = useState('')
  const [searchText, setSearchText] = useState('')
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [toasts, setToasts] = useState<Toast[]>([])
  const [memoryDialog, setMemoryDialog] = useState<MemoryEntry | 'new' | null>(null)
  const [memoryTitle, setMemoryTitle] = useState('')
  const [memoryContent, setMemoryContent] = useState('')
  const [memoryBusy, setMemoryBusy] = useState(false)
  const requestInputRef = useRef<HTMLTextAreaElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)
  const taskDetailsRef = useRef<HTMLElement>(null)
  const menuToggleRef = useRef<HTMLButtonElement>(null)
  const contextToggleRef = useRef<HTMLButtonElement>(null)

  const currentPlan = plans.find((plan) => plan.id === currentPlanId)
  const filteredTasks = useMemo(() => tasks.filter((task) => task.title.toLocaleLowerCase().includes(searchText.toLocaleLowerCase())), [tasks, searchText])
  const filteredPlans = useMemo(() => plans.filter((plan) => `${plan.request} ${plan.steps.map((step) => step.taskTitle).join(' ')}`.toLocaleLowerCase().includes(searchText.toLocaleLowerCase())), [plans, searchText])
  const filteredMemories = useMemo(() => memories.filter((memory) => `${memory.title} ${memory.content}`.toLocaleLowerCase().includes(searchText.toLocaleLowerCase())), [memories, searchText])

  function toast(text: string, kind: Toast['kind'] = 'success') {
    const id = Date.now() + Math.random()
    setToasts((items) => [...items, { id, text, kind }])
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 4200)
  }

  async function refreshData() {
    try {
      const [taskRows, memoryRows, activityRows, planRows] = await Promise.all([api.tasks(), api.memories(), api.activity(), api.plans()])
      setTasks(taskRows)
      setMemories(memoryRows)
      setActivity(activityRows)
      setPlans(planRows)
      setCurrentPlanId((current) => current || planRows[0]?.id || '')
      setReady(true)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Forge could not connect to its local service.')
      setReady(false)
    }
  }

  // This effect synchronizes the initial view with persisted local server data.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { void refreshData() }, [])

  useEffect(() => {
    function handleGlobalKeys(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        setMobileNavOpen(false)
        setMobileContextOpen(false)
        if (memoryDialog) setMemoryDialog(null)
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !event.altKey) {
        event.preventDefault()
        setSection('chat')
        setCurrentPlanId('')
        window.requestAnimationFrame(() => requestInputRef.current?.focus())
      }
    }
    window.addEventListener('keydown', handleGlobalKeys)
    return () => window.removeEventListener('keydown', handleGlobalKeys)
  }, [memoryDialog])

  useEffect(() => {
    if (!mobileNavOpen) return
    const restoreFocus = menuToggleRef.current
    const closeButton = sidebarRef.current?.querySelector<HTMLElement>('.mobile-close')
    closeButton?.focus()
    function containTab(event: globalThis.KeyboardEvent) { trapDrawerTab(event, sidebarRef.current) }
    document.addEventListener('keydown', containTab)
    return () => {
      document.removeEventListener('keydown', containTab)
      if (restoreFocus?.isConnected) window.requestAnimationFrame(() => restoreFocus.focus())
    }
  }, [mobileNavOpen])

  useEffect(() => {
    if (!mobileContextOpen || !window.matchMedia('(max-width: 680px)').matches) return
    const restoreFocus = contextToggleRef.current
    const closeButton = taskDetailsRef.current?.querySelector<HTMLElement>('.context-drawer-header button')
    closeButton?.focus()
    function containTab(event: globalThis.KeyboardEvent) { trapDrawerTab(event, taskDetailsRef.current) }
    document.addEventListener('keydown', containTab)
    return () => {
      document.removeEventListener('keydown', containTab)
      if (restoreFocus?.isConnected) window.requestAnimationFrame(() => restoreFocus.focus())
    }
  }, [mobileContextOpen])

  async function createPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (draft.trim().length < 2 || loading) return
    setLoading(true)
    setError('')
    try {
      const plan = await api.draftPlan(draft)
      setPlans((items) => [plan, ...items.filter((item) => item.id !== plan.id)])
      setCurrentPlanId(plan.id)
      setDraft('')
      setSection('chat')
      toast('Plan drafted. Nothing has run yet.')
      void refreshActivity()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not draft that plan.')
    } finally {
      setLoading(false)
    }
  }

  async function refreshActivity() {
    try { setActivity(await api.activity()) } catch { /* keep the last visible audit list */ }
  }

  function updateStepTitle(planId: string, stepId: string, value: string) {
    setDirtyPlanIds((ids) => new Set(ids).add(planId))
    setPlans((items) => items.map((plan) => plan.id !== planId ? plan : {
      ...plan,
      steps: plan.steps.map((step) => step.id === stepId ? { ...step, taskTitle: value, title: `Add task: ${value}`, status: step.status === 'done' ? 'done' : 'pending', approvalId: undefined, expiresAt: undefined } : step),
    }))
  }

  async function savePlan(plan: Plan) {
    setLoading(true)
    try {
      const updated = await api.updatePlan(plan.id, plan.steps.map((step) => ({ id: step.id, taskTitle: step.taskTitle })))
      setPlans((items) => items.map((item) => item.id === updated.id ? updated : item))
      setDirtyPlanIds((ids) => { const next = new Set(ids); next.delete(plan.id); return next })
      toast('Plan saved. Any previous approvals were cleared.')
      void refreshActivity()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save the plan.', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function approveStep(plan: Plan, stepId: string) {
    setLoading(true)
    try {
      const updated = await api.approve(plan.id, stepId)
      setPlans((items) => items.map((item) => item.id === updated.id ? updated : item))
      toast('Approved for 10 minutes. The action has not run yet.')
      void refreshActivity()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not approve this action.', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function denyStep(plan: Plan, stepId: string) {
    setLoading(true)
    try {
      const updated = await api.deny(plan.id, stepId)
      setPlans((items) => items.map((item) => item.id === updated.id ? updated : item))
      toast('Declined. No task was created.')
      void refreshActivity()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not decline this action.', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function executeStep(plan: Plan, stepId: string) {
    setLoading(true)
    try {
      const result = await api.execute(plan.id, stepId)
      setPlans((items) => items.map((item) => item.id === result.plan.id ? result.plan : item))
      await refreshData()
      if (result.approvalReset) toast('Approval expired or changed. Review the task details and approve again.', 'error')
      else if (result.replayed) toast('This step was already completed; no duplicate task was created.')
      else toast('Task created in Forge.')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'The action failed.', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function deleteTask(task: ForgeTask) {
    if (!window.confirm(`Delete “${task.title}” from your local Forge task list?`)) return
    try {
      await api.deleteTask(task.id)
      await refreshData()
      toast('Task deleted.')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not delete that task.', 'error')
    }
  }

  async function deletePlan(plan: Plan) {
    const confirmed = window.confirm('Delete this plan and any local tasks created from it? Request text and task details will be removed. Export your data first if you want to keep those details; generic approval and outcome entries remain in Activity.')
    if (!confirmed) return
    try {
      await api.deletePlan(plan.id)
      setPlans((items) => items.filter((item) => item.id !== plan.id))
      setDirtyPlanIds((ids) => { const next = new Set(ids); next.delete(plan.id); return next })
      if (currentPlanId === plan.id) setCurrentPlanId('')
      await refreshData()
      toast('Plan and linked local tasks deleted. Generic activity entries were retained.')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not delete that plan.', 'error')
    }
  }

  async function exportLocalData() {
    try {
      const data = await api.exportWorkspace()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `forge-data-${new Date().toISOString().slice(0, 10)}.json`
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast('Local data exported as JSON.')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not export local data.', 'error')
    }
  }

  async function clearLocalData() {
    const confirmed = window.confirm('Clear all Forge plans, tasks, memories, approvals and activity stored on this device? This removes database rows, but SQLite deletion is not guaranteed secure erasure.')
    if (!confirmed) return
    try {
      await api.clearWorkspace()
      setPlans([])
      setCurrentPlanId('')
      setDirtyPlanIds(new Set())
      await refreshData()
      toast('Local workspace data cleared. SQLite deletion is not guaranteed secure erasure.')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not clear local data.', 'error')
    }
  }

  function openMemory(entry: MemoryEntry | 'new') {
    setMemoryDialog(entry)
    setMemoryTitle(entry === 'new' ? '' : entry.title)
    setMemoryContent(entry === 'new' ? '' : entry.content)
  }

  async function saveMemory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!memoryDialog || memoryBusy) return
    setMemoryBusy(true)
    try {
      if (memoryDialog === 'new') await api.createMemory(memoryTitle, memoryContent)
      else await api.updateMemory(memoryDialog.id, memoryTitle, memoryContent)
      await refreshData()
      setMemoryDialog(null)
      toast(memoryDialog === 'new' ? 'Memory saved.' : 'Memory updated.')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save that memory.', 'error')
    } finally {
      setMemoryBusy(false)
    }
  }

  async function deleteMemory(entry: MemoryEntry) {
    if (!window.confirm(`Forget “${entry.title}”? Its saved content will be deleted.`)) return
    try {
      await api.deleteMemory(entry.id)
      await refreshData()
      toast('Memory forgotten.')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not delete that memory.', 'error')
    }
  }

  function handleComposerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  const mobileViewport = window.matchMedia('(max-width: 680px)').matches
  const title = section === 'chat' ? currentPlan?.request ?? 'New task' : navigation.find((item) => item.id === section)?.label ?? 'Home'
  const taskStatus = currentPlan?.status === 'draft' ? 'Draft' : currentPlan?.status === 'in_progress' ? 'In progress' : currentPlan?.status === 'completed' ? 'Completed' : ''

  return (
    <div className={`app-shell ${desktopNavCollapsed ? 'nav-collapsed' : ''}`}>
      <aside ref={sidebarRef} className={`sidebar ${mobileNavOpen ? 'sidebar-open' : ''} ${desktopNavCollapsed ? 'sidebar-collapsed' : ''}`} aria-label="Main navigation" aria-hidden={mobileViewport && !mobileNavOpen} inert={mobileViewport && !mobileNavOpen}>
        <div className="brand-row">
          <div className="brand-mark" aria-hidden="true"><span>F</span><i /></div>
          <div className="brand-copy"><strong>Forge</strong><span>Personal agent</span></div>
          <button className="icon-button mobile-close" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)}><X size={18} /></button>
        </div>
        <button className="new-chat-button" aria-label="New task" title="New task" onClick={() => { setSection('chat'); setCurrentPlanId(''); setMobileNavOpen(false) }}><SquarePen size={17} /><span>New task</span></button>
        <div className="nav-label">Workspace</div>
        <nav className="primary-nav">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`nav-item ${section === id ? 'active' : ''}`} aria-current={section === id ? 'page' : undefined} title={label} onClick={() => { setSection(id); if (id === 'history') setHistoryTab('plans'); setMobileNavOpen(false) }}>
              <Icon size={18} strokeWidth={1.8} /><span>{label}</span>{id === 'history' && tasks.length > 0 && <span className="nav-count">{tasks.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-card"><LockKeyhole size={15} /><div><strong>Private workspace</strong><span>Stored on this device</span></div></div>
          <div className="user-card"><div className="avatar">D</div><div><strong>Davids</strong><span>Personal workspace</span></div><MoreHorizontal size={18} className="user-more" /></div>
        </div>
      </aside>

      {mobileNavOpen && <button className="mobile-backdrop" aria-hidden="true" tabIndex={-1} onClick={() => setMobileNavOpen(false)} />}

      <main className="main-shell" aria-hidden={mobileViewport && mobileNavOpen} inert={mobileViewport && mobileNavOpen}>
        <header className="topbar" aria-hidden={mobileViewport && mobileContextOpen} inert={mobileViewport && mobileContextOpen}>
          <div className="topbar-left"><button ref={menuToggleRef} className="icon-button menu-button" aria-label={mobileViewport ? mobileNavOpen ? 'Close navigation' : 'Open navigation' : desktopNavCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={mobileViewport ? mobileNavOpen : !desktopNavCollapsed} onClick={() => { if (mobileViewport) setMobileNavOpen((open) => !open); else setDesktopNavCollapsed((collapsed) => !collapsed) }}><span className="mobile-menu-icon"><Menu size={19} /></span><span className="desktop-menu-icon">{desktopNavCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</span></button><span className="breadcrumb">Workspace</span><ArrowRight size={14} className="breadcrumb-arrow" /><span className="breadcrumb-current" title={title}>{title}</span></div>
          <div className="topbar-right">{section === 'chat' && currentPlan && <><span className={`active-task-status ${currentPlan.status}`} aria-label={`Task status: ${taskStatus}`}>{taskStatus}</span><button className="task-header-action" aria-label="Open task history" title="Open task history" onClick={() => { setHistoryTab('plans'); setSection('history') }}><History size={15} /><span>History</span></button><button className="task-header-action" aria-label="Start a new task" title="Start a new task" onClick={() => { setCurrentPlanId(''); setDraft(''); setSection('chat'); window.requestAnimationFrame(() => requestInputRef.current?.focus()) }}><SquarePen size={15} /><span>New task</span></button></>}<span className={`connection-pill ${ready ? 'online' : 'offline'}`}><i />{ready ? 'Local service connected' : 'Connecting'}</span><button className="help-button" aria-label="About this prototype" onClick={() => setSection('settings')}><CircleHelp size={18} /></button></div>
        </header>

        <div className="main-scroll">
          {error && <div className="error-banner" role="alert"><CircleHelp size={17} /><span>{error}</span><button onClick={() => void refreshData()}>Retry</button></div>}
          {section === 'home' && <section className="dashboard-view">
            <PageHeader icon={<Home size={19} />} eyebrow="YOUR WORKSPACE" title="Welcome back, Davids" description="A calm place to plan what matters and keep the next step clear." action={<button className="primary-button" onClick={() => { setSection('chat'); setCurrentPlanId('') }}><SquarePen size={15} /> New task</button>} />
            <div className="dashboard-top-grid">
              <article className="dashboard-hero"><div className="dashboard-hero-orb"><Sparkles size={20} /></div><span className="eyebrow">A LITTLE MOMENTUM</span><h2>What would you like to move forward?</h2><p>Start with a task. Forge will make a local plan for you to review before anything happens.</p><button className="secondary-button" onClick={() => setSection('chat')}>Open new task <ArrowRight size={14} /></button></article>
              <article className="dashboard-quick-starts"><div className="section-heading"><div><span className="eyebrow">QUICK STARTS</span><h2>Pick a place to begin</h2></div><Sparkles size={17} /></div><div className="quick-start-list">{quickStarts.map((prompt) => <button key={prompt} className="quick-start-button" onClick={() => { setDraft(prompt); setCurrentPlanId(''); setSection('chat') }}><span>{prompt}</span><ArrowRight size={15} /></button>)}</div></article>
            </div>
            <div className="dashboard-lower-grid">
              <article className="dashboard-panel"><div className="section-heading"><div><span className="eyebrow">RECENT WORK</span><h2>Your latest tasks</h2></div><button className="text-link" onClick={() => { setHistoryTab('tasks'); setSection('history') }}>View history <ArrowRight size={14} /></button></div>{tasks.slice(0, 3).length ? <div className="dashboard-row-list">{tasks.slice(0, 3).map((task) => <div className="dashboard-row" key={task.id}><span className="dashboard-row-icon task"><Check size={15} /></span><span className="dashboard-row-copy"><strong>{task.title}</strong><small>Local task · {formatDate(task.createdAt)}</small></span></div>)}</div> : <div className="dashboard-empty"><CheckCheck size={17} /><span>No tasks yet. Approved local tasks will show up here.</span></div>}</article>
              <article className="dashboard-panel"><div className="section-heading"><div><span className="eyebrow">ACTIVITY</span><h2>What’s happened</h2></div><button className="text-link" onClick={() => { setHistoryTab('activity'); setSection('history') }}>View activity <ArrowRight size={14} /></button></div>{activity.slice(0, 3).length ? <div className="dashboard-row-list">{activity.slice(0, 3).map((event) => <div className="dashboard-row" key={event.id}><span className="dashboard-row-icon activity"><Activity size={15} /></span><span className="dashboard-row-copy"><strong>{event.summary}</strong><small>{formatDate(event.occurredAt)}</small></span></div>)}</div> : <div className="dashboard-empty"><Activity size={17} /><span>Your activity will appear here as you plan and review work.</span></div>}</article>
            </div>
            <div className="dashboard-honesty"><LockKeyhole size={15} /><span>This prototype only creates and manages plans and tasks on this device. Connected services and automations are not active.</span></div>
          </section>}
          {section === 'chat' && <section className="chat-layout">
            <div className="chat-column" aria-hidden={mobileViewport && mobileContextOpen} inert={mobileViewport && mobileContextOpen}>
              <div className="chat-heading"><div className="forge-orb"><Sparkles size={20} /></div><div><p className="eyebrow">FORGE</p><h1>What’s on your mind?</h1><p className="heading-subtitle">Describe a goal and Forge will turn it into a plan you can review.</p></div></div>
              {currentPlan ? <div className="conversation-block">
                <div className="message-bubble user-bubble"><span className="message-label">YOU</span><p>{currentPlan.request}</p></div>
                <div className="agent-message"><div className="agent-avatar"><Sparkles size={15} /></div><div className="agent-message-body"><div className="agent-name-row"><strong>Forge</strong><span>Plan draft · review before running</span></div><PlanCard plan={currentPlan} loading={loading} hasUnsavedEdits={dirtyPlanIds.has(currentPlan.id)} onTitleChange={updateStepTitle} onSave={() => void savePlan(currentPlan)} onApprove={(stepId) => void approveStep(currentPlan, stepId)} onDeny={(stepId) => void denyStep(currentPlan, stepId)} onExecute={(stepId) => void executeStep(currentPlan, stepId)} /></div></div>
              </div> : loading ? <div className="empty-prompt planning-state" role="status"><div className="empty-prompt-icon"><LoaderCircle className="spin" size={19} /></div><p>Thinking through the steps…</p><span>Nothing is running. You’ll review the draft first.</span></div> : <div className="empty-prompt"><div className="empty-prompt-icon"><MessageSquare size={19} /></div><p>Start with a goal or question.</p><span>Forge will turn it into a clear, editable plan before anything important happens.</span></div>}
              <form className="composer" onSubmit={createPlan}>
                <label className="sr-only" htmlFor="request">Message Forge</label>
                <textarea ref={requestInputRef} id="request" aria-keyshortcuts="Control+K Meta+K" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={handleComposerKey} maxLength={2000} placeholder="Ask Forge to help with something…" rows={3} />
                <div className="composer-footer"><div className="composer-hint"><span className="composer-sparkle"><Sparkles size={14} /></span><span>Plans are editable. Actions wait for your approval.</span><kbd>Ctrl/⌘ K</kbd></div><div className="composer-actions"><div className="composer-tools" aria-label="Optional input methods"><button className="composer-tool" type="button" disabled title="File attachments aren’t active in this prototype" aria-label="Attach a file, unavailable"><Paperclip size={15} /></button><button className="composer-tool" type="button" disabled title="Voice input isn’t active in this prototype" aria-label="Voice input, unavailable"><Mic size={15} /></button></div><span>{draft.length}/2,000</span><button className="send-button" type="submit" disabled={loading || draft.trim().length < 2}>{loading ? <LoaderCircle className="spin" size={17} /> : <Send size={16} />}<span>Plan it</span></button></div></div>
              </form>
              <p className="prototype-note">Forge plans first, then waits for your approval before important actions.</p>
            </div>
            <button ref={contextToggleRef} className="context-toggle" aria-label="Open task details" aria-expanded={mobileContextOpen} aria-hidden={mobileViewport && mobileContextOpen} inert={mobileViewport && mobileContextOpen} onClick={() => setMobileContextOpen(true)}><PanelRight size={16} /> Task details</button>
            {mobileContextOpen && <button className="context-backdrop" aria-hidden="true" tabIndex={-1} onClick={() => setMobileContextOpen(false)} />}
            <aside ref={taskDetailsRef} className={`right-rail ${mobileContextOpen ? 'context-open' : ''}`} aria-label="Task details" role={mobileViewport ? 'dialog' : 'complementary'} aria-modal={mobileViewport && mobileContextOpen ? true : undefined} aria-hidden={mobileViewport && !mobileContextOpen} inert={mobileViewport && !mobileContextOpen}><div className="context-drawer-header"><strong>Task details</strong><button className="icon-button" aria-label="Close task details" onClick={() => setMobileContextOpen(false)}><X size={17} /></button></div><div className="rail-card"><div className="rail-card-heading"><div className="rail-icon"><ShieldCheck size={17} /></div><strong>Your control comes first</strong></div><p>Review each action before it runs. Editing a plan clears any earlier approval.</p><div className="rail-divider" /><div className="rail-meta-row"><span>Current mode</span><strong>Review every action</strong></div><div className="rail-meta-row"><span>Approval window</span><strong>10 minutes</strong></div></div><div className="rail-card"><div className="quick-card-title"><FileText size={16} /><strong>Sources & files</strong></div><div className="rail-meta-row"><span>Sources</span><strong>None in this draft</strong></div><div className="rail-meta-row"><span>Files</span><strong>Not attached</strong></div></div><div className="rail-card quick-card"><div className="quick-card-title"><Clock3 size={16} /><strong>Today so far</strong></div><div className="quick-stats"><div><strong>{tasks.length}</strong><span>tasks</span></div><div><strong>{activity.length}</strong><span>activity events</span></div></div><button className="text-link" onClick={() => { setHistoryTab('activity'); setSection('history'); setMobileContextOpen(false) }}>View activity <ArrowRight size={14} /></button></div><div className="rail-disclosure"><LockKeyhole size={14} /><span>This prototype stores data locally on this device. Don’t save secrets here.</span></div></aside>
          </section>}

          {section === 'history' && historyTab === 'tasks' && <section className="page-view"><PageHeader icon={<History size={19} />} eyebrow="YOUR WORKSPACE" title="Task history" description="Search and manage the local work Forge has completed or saved." /><HistoryTabs active={historyTab} onChange={setHistoryTab} />
            <div className="list-toolbar"><label className="search-field"><Search size={16} /><input aria-label="Search tasks" placeholder="Search tasks" value={searchText} onChange={(event) => setSearchText(event.target.value)} />{searchText && <button aria-label="Clear search" onClick={() => setSearchText('')}><X size={14} /></button>}</label><span className="result-count">{filteredTasks.length} {filteredTasks.length === 1 ? 'task' : 'tasks'}</span></div>
            {filteredTasks.length ? <div className="item-list">{filteredTasks.map((task) => <article className="list-card task-card" key={task.id}><div className="task-check"><Check size={16} /></div><div className="list-card-main"><strong>{task.title}</strong><span>Created {formatDate(task.createdAt)}</span></div><button className="icon-button danger-hover" aria-label={`Delete ${task.title}`} onClick={() => void deleteTask(task)}><Trash2 size={16} /></button></article>)}</div> : <EmptyState icon={<CheckCheck size={20} />} title={searchText ? 'No tasks match that search' : 'No tasks yet'} text={searchText ? 'Try a shorter search.' : 'When you approve a plan step, its task will show up here.'} />}
          </section>}

          {section === 'history' && historyTab === 'plans' && <section className="page-view">
            <PageHeader icon={<History size={19} />} eyebrow="YOUR WORKSPACE" title="Task history" description="Search and manage your saved plans, tasks and activity." /><HistoryTabs active={historyTab} onChange={setHistoryTab} />
            <div className="list-toolbar"><label className="search-field"><Search size={16} /><input aria-label="Search plans" placeholder="Search plans" value={searchText} onChange={(event) => setSearchText(event.target.value)} />{searchText && <button aria-label="Clear search" onClick={() => setSearchText('')}><X size={14} /></button>}</label><span className="result-count">{filteredPlans.length} {filteredPlans.length === 1 ? 'plan' : 'plans'}</span></div>
            {filteredPlans.length ? <div className="plan-history-list">{filteredPlans.map((plan) => <article className="plan-history-card" key={plan.id}><div className="plan-history-icon"><ListTodo size={16} /></div><div className="plan-history-main"><strong>{plan.request}</strong><span>{plan.steps.length} {plan.steps.length === 1 ? 'step' : 'steps'} · {plan.status.replace('_', ' ')} · Updated {formatDate(plan.updatedAt)}</span></div><button className="secondary-button" onClick={() => { setCurrentPlanId(plan.id); setSection('chat') }}>Open plan</button><button className="icon-button danger-hover" aria-label="Delete plan and linked local tasks" onClick={() => void deletePlan(plan)}><Trash2 size={16} /></button></article>)}</div> : <EmptyState icon={<ListTodo size={20} />} title={searchText ? 'No plans match that search' : 'No saved plans yet'} text={searchText ? 'Try a shorter search.' : 'When you ask Forge to plan something, you’ll find the saved request here.'} />}
          </section>}

          {section === 'memory' && <section className="page-view"><PageHeader icon={<BookOpen size={19} />} eyebrow="YOUR CONTEXT" title="Memory" description="Only details you add here are saved. Edit or forget them whenever you like." action={<button className="primary-button" onClick={() => openMemory('new')}><Plus size={16} /> Add memory</button>} />
            <div className="memory-disclosure"><LockKeyhole size={16} /><p><strong>Owner-added only.</strong> These notes are stored on this device and aren’t used to personalize anything in this prototype yet.</p></div>
            <div className="list-toolbar"><label className="search-field"><Search size={16} /><input aria-label="Search memories" placeholder="Search memories" value={searchText} onChange={(event) => setSearchText(event.target.value)} />{searchText && <button aria-label="Clear search" onClick={() => setSearchText('')}><X size={14} /></button>}</label><span className="result-count">{filteredMemories.length} saved</span></div>
            {filteredMemories.length ? <div className="memory-grid">{filteredMemories.map((entry) => <article className="memory-card" key={entry.id}><div className="memory-card-top"><span className="memory-source"><span className="source-dot" /> You added this</span><button className="icon-button" aria-label={`More actions for ${entry.title}`} onClick={() => openMemory(entry)}><MoreHorizontal size={17} /></button></div><h2>{entry.title}</h2><p>{entry.content}</p><div className="memory-card-footer"><span>Updated {formatDate(entry.updatedAt)}</span><div><button onClick={() => openMemory(entry)}>Edit</button><button className="danger-link" onClick={() => void deleteMemory(entry)}>Forget</button></div></div></article>)}</div> : <EmptyState icon={<BookOpen size={20} />} title={searchText ? 'No memories match that search' : 'Your memory starts with you'} text={searchText ? 'Try a shorter search.' : 'Add a preference or detail you want to keep nearby. You’re in control of every note.'} action={!searchText ? <button className="primary-button" onClick={() => openMemory('new')}><Plus size={16} /> Add a memory</button> : undefined} />}
          </section>}

          {section === 'inbox' && <section className="page-view"><PageHeader icon={<Inbox size={19} />} eyebrow="YOUR MESSAGES" title="Inbox" description="A future home for messages you choose to connect." /><FeatureState icon={<Inbox size={21} />} title="No inbox is connected" description="Forge can’t read, draft or send email in this prototype. Once a mail service is connected, messages will only be sent after you review and approve them." action={<button className="secondary-button" onClick={() => setSection('settings')}>View privacy settings <ArrowRight size={14} /></button>} /></section>}

          {section === 'projects' && <section className="page-view"><PageHeader icon={<FolderOpen size={19} />} eyebrow="YOUR WORKSPACES" title="Projects" description="Keep related plans and context together as the workspace grows." /><FeatureState icon={<FolderOpen size={21} />} title="Project spaces aren’t active yet" description="For now, your saved requests and local tasks live in Task history. This screen doesn’t create or sync project data." action={<button className="secondary-button" onClick={() => { setHistoryTab('plans'); setSection('history') }}>Browse saved plans <ArrowRight size={14} /></button>} /></section>}

          {section === 'automations' && <section className="page-view"><PageHeader icon={<CalendarClock size={19} />} eyebrow="BACKGROUND WORK" title="Automations" description="Nothing runs on a schedule or in the background in this prototype." /><FeatureState icon={<CalendarClock size={21} />} title="No automations are running" description="Scheduled and event-triggered workflows aren’t connected. Every plan you make here starts only when you submit it, and each local action waits for approval." action={<button className="secondary-button" onClick={() => { setSection('chat'); setCurrentPlanId('') }}>Plan a task instead <ArrowRight size={14} /></button>} /></section>}

          {section === 'connected' && <section className="page-view"><PageHeader icon={<Blocks size={19} />} eyebrow="PERMISSIONS YOU CONTROL" title="Connected Apps" description="See which services are linked and what Forge can access." /><div className="connection-summary"><span className="connection-summary-icon"><LockKeyhole size={18} /></span><div><strong>No apps connected</strong><p>This prototype has no email, calendar, messaging, storage or web-search connections.</p></div><span className="not-connected-pill">0 connected</span></div><div className="connection-list"><ConnectionCard icon={<Inbox size={17} />} title="Email" detail="Read, draft and send mail after approval" /><ConnectionCard icon={<CalendarClock size={17} />} title="Calendar" detail="Review availability and create approved events" /><ConnectionCard icon={<MessageSquare size={17} />} title="Messaging" detail="Draft messages and send only after approval" /><ConnectionCard icon={<Files size={17} />} title="Files" detail="Select, summarize and edit files you choose" /></div><p className="connection-disclosure"><ShieldCheck size={14} /> These are examples of future integrations, not active permissions. Nothing is connected or being accessed.</p></section>}

          {section === 'files' && <section className="page-view"><PageHeader icon={<Files size={19} />} eyebrow="YOUR DOCUMENTS" title="Files" description="A place for files you choose to bring into a task." /><FeatureState icon={<Files size={21} />} title="File access isn’t available yet" description="This prototype can’t browse, upload, read or change your files. You can still create a local plan for a task that involves a document, but Forge won’t see the document itself." action={<button className="secondary-button" onClick={() => { setSection('chat'); setCurrentPlanId('') }}>Create a local plan <ArrowRight size={14} /></button>} /></section>}

          {section === 'history' && historyTab === 'activity' && <section className="page-view"><PageHeader icon={<History size={19} />} eyebrow="TRANSPARENCY" title="Task history" description="A clear record of local plans, approvals and outcomes." /><HistoryTabs active={historyTab} onChange={setHistoryTab} />
            <div className="audit-notice"><ShieldCheck size={17} /><span>Activity shows request/task details from records still saved on this device. Delete a plan to remove those details; its generic approval and outcome history remains. Export first if you want to keep a detailed copy.</span></div>
            {activity.length ? <div className="timeline">{activity.map((event) => <article className="timeline-item" key={event.id}><div className={`timeline-dot ${event.eventType.includes('failed') ? 'failed' : ''}`} /><div className="timeline-card"><div className="timeline-header"><strong>{event.summary}</strong><time>{formatDate(event.occurredAt)}</time></div>{event.context && <p className="event-context">{event.context}</p>}{event.detailsRemoved && <span className="event-redacted"><LockKeyhole size={12} /> Details removed</span>}<span className="event-kind">{event.eventType.replaceAll('.', ' · ')}</span></div></article>)}</div> : <EmptyState icon={<Activity size={20} />} title="Nothing has happened yet" text="Once you draft a plan, this timeline will show it here." />}
          </section>}

          {section === 'settings' && <section className="page-view">
            <PageHeader icon={<Settings2 size={19} />} eyebrow="YOUR PREFERENCES" title="Settings" description="See what this build can do today, and what remains to be connected." />
            <div className="settings-grid">
              <article className="settings-card"><div className="settings-icon"><ShieldCheck size={18} /></div><div><h2>Approval mode</h2><p>Every local task waits for your explicit approval. Automatic workflows and external services are not connected.</p><span className="settings-status"><span className="source-dot" /> Review before every action</span></div></article>
              <article className="settings-card"><div className="settings-icon"><LockKeyhole size={18} /></div><div><h2>Storage and privacy</h2><p>Plans, tasks, memories and activity live in a local SQLite database on this device. There is no account or cloud sync in this prototype.</p><span className="settings-status">Do not store passwords or payment details</span></div></article>
              <article className="settings-card"><div className="settings-icon"><Sparkles size={18} /></div><div><h2>Connected services</h2><p>No email, calendar or messaging service is connected. Nothing can be sent or changed outside this local workspace.</p><span className="settings-status">0 services connected</span></div></article>
              <article className="settings-card"><div className="settings-icon"><FileText size={18} /></div><div><h2>Data lifecycle</h2><p>Export a JSON copy, or clear local workspace records. SQLite row deletion is not guaranteed secure erasure.</p><span className="settings-status">Local prototype · single device · no cloud backup</span></div></article>
            </div>
            <div className="data-actions"><div><h2>Manage local data</h2><p>Export includes saved plan requests, tasks, memories, approvals, and activity. Clear removes those database rows and all retained activity.</p></div><div className="data-action-buttons"><button className="secondary-button" onClick={() => void exportLocalData()}><FileText size={14} /> Export JSON</button><button className="clear-data-button" onClick={() => void clearLocalData()}><Trash2 size={14} /> Clear all local data</button></div></div>
          </section>}
        </div>
      </main>

      {memoryDialog && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setMemoryDialog(null) }}><section className="memory-modal" role="dialog" aria-modal="true" aria-labelledby="memory-dialog-title"><div className="modal-top"><div><span className="eyebrow">YOUR PERSONAL CONTEXT</span><h2 id="memory-dialog-title">{memoryDialog === 'new' ? 'Add a memory' : 'Edit memory'}</h2></div><button className="icon-button" aria-label="Close dialog" onClick={() => setMemoryDialog(null)}><X size={18} /></button></div><p className="modal-intro">Only save something you’re comfortable keeping on this device.</p><form onSubmit={saveMemory}><label>Title<input value={memoryTitle} onChange={(event) => setMemoryTitle(event.target.value)} minLength={2} maxLength={80} required autoFocus placeholder="e.g. Writing style" /></label><label>What should Forge remember?<textarea value={memoryContent} onChange={(event) => setMemoryContent(event.target.value)} minLength={2} maxLength={1200} required rows={5} placeholder="Add a preference or context you want to keep nearby." /></label><div className="modal-warning"><LockKeyhole size={15} /><span>Stored locally. Don’t add passwords, payment details, or anything you wouldn’t want saved on this device.</span></div><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setMemoryDialog(null)}>Cancel</button><button className="primary-button" disabled={memoryBusy || memoryTitle.trim().length < 2 || memoryContent.trim().length < 2} type="submit">{memoryBusy ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />} Save memory</button></div></form></section></div>}

      <div className="toast-stack" aria-live="polite">{toasts.map((item) => <div className={`toast ${item.kind}`} key={item.id}><span>{item.kind === 'success' ? <Check size={15} /> : <CircleHelp size={15} />}</span>{item.text}<button aria-label="Dismiss notification" onClick={() => setToasts((items) => items.filter((entry) => entry.id !== item.id))}><X size={14} /></button></div>)}</div>
    </div>
  )
}

function PlanCard({ plan, loading, hasUnsavedEdits, onTitleChange, onSave, onApprove, onDeny, onExecute }: { plan: Plan; loading: boolean; hasUnsavedEdits: boolean; onTitleChange: (planId: string, stepId: string, value: string) => void; onSave: () => void; onApprove: (stepId: string) => void; onDeny: (stepId: string) => void; onExecute: (stepId: string) => void }) {
  const createdTasks = plan.steps.filter((step) => step.status === 'done').length
  const waitingForReview = plan.steps.some((step) => step.status === 'pending')
  const waitingToRun = plan.steps.some((step) => step.status === 'approved')
  const allResolved = plan.steps.every((step) => step.status === 'done' || step.status === 'denied')
  const taskStage = allResolved ? createdTasks ? `${createdTasks} local ${createdTasks === 1 ? 'task' : 'tasks'} created` : 'Declined · no tasks created' : waitingToRun || createdTasks > 0 ? `${createdTasks} of ${plan.steps.length} tasks created` : 'No task has run'
  return (
    <div className="plan-card">
      <ol className="progress-track" aria-label="Local task progress">
        <li className="complete"><span className="progress-dot"><Check size={12} /></span><span><strong>Plan ready</strong><small>Local draft</small></span></li>
        <li className={waitingForReview ? 'active' : 'complete'}><span className="progress-dot">{waitingForReview ? <ShieldCheck size={12} /> : <Check size={12} />}</span><span><strong>{waitingForReview ? 'Your review' : 'Review done'}</strong><small>{waitingForReview ? 'Waiting for you' : 'Choices saved'}</small></span></li>
        <li className={allResolved ? 'complete' : waitingToRun || createdTasks > 0 ? 'active' : 'pending'}><span className="progress-dot">{allResolved && createdTasks > 0 ? <Check size={12} /> : <ListTodo size={12} />}</span><span><strong>Local task</strong><small>{taskStage}</small></span></li>
      </ol>
      <div className="plan-card-header">
        <div>
          <div className="plan-kicker"><Sparkles size={14} /> {plan.generationMode === 'ai' ? 'AI-ASSISTED DRAFT' : 'BASIC LOCAL DRAFT'}</div>
          <h2>Here’s a first pass</h2>
          <p>Forge mapped the work into checkpoints. Review each step, then continue when its dependencies are ready.</p>
        </div>
        <span className={`plan-status ${plan.status}`}>{plan.status.replace('_', ' ')}</span>
      </div>
      <div className="steps-list">
        {plan.steps.map((step, index) => (
          <article className={`plan-step ${step.status}`} key={step.id}>
            <div className="step-index">{step.status === 'done' ? <Check size={14} /> : step.status === 'active' ? <LoaderCircle className="spin" size={14} /> : step.status === 'failed' ? <X size={14} /> : index + 1}</div>
            <div className="step-content">
              <label className="sr-only" htmlFor={`step-${step.id}`}>Task title for step {index + 1}</label>
              <input id={`step-${step.id}`} value={step.taskTitle} maxLength={120} onChange={(event) => onTitleChange(plan.id, step.id, event.target.value)} disabled={step.status === 'done' || step.status === 'active'} />
              <details className="step-details"><summary>What this step does</summary><p>{step.detail}</p><p>Running this step only adds a task to Forge on this device. It won’t contact an external service.</p></details>
              {step.checkpoint && <span className="step-checkpoint"><ShieldCheck size={12} /> {step.checkpoint}</span>}
              {step.status === 'approved' && step.expiresAt && <span className="approval-expiry"><Clock3 size={13} /> Approved until {formatDate(step.expiresAt)}</span>}
              {step.status === 'active' && <span className="step-running"><LoaderCircle className="spin" size={12} /> Working this step…</span>}
              {step.status === 'done' && step.output && <span className="step-output"><Check size={12} /> {step.output}</span>}
              {step.status === 'failed' && <span className="step-error"><X size={12} /> {step.error ?? 'This step needs attention.'}</span>}
              {step.status === 'denied' && <span className="denied-note">Declined. No task was created.</span>}
            </div>
            <div className="step-controls">
              {step.status === 'pending' && <>
                <button className="approve-button" disabled={loading || hasUnsavedEdits || step.taskTitle.trim().length < 2 || Boolean(step.dependsOn?.some((dependencyId) => !plan.steps.some((candidate) => candidate.id === dependencyId && (candidate.status === 'done' || candidate.status === 'denied'))))} onClick={() => onApprove(step.id)}><ShieldCheck size={14} /> Approve</button>
                <button className="quiet-button" disabled={loading || hasUnsavedEdits} onClick={() => onDeny(step.id)}>Decline</button>
              </>}
              {step.status === 'approved' && <button className="run-button" disabled={loading || hasUnsavedEdits} onClick={() => onExecute(step.id)}>{loading ? <LoaderCircle className="spin" size={14} /> : <ArrowDown size={14} />} Run task</button>}
              {step.status === 'done' && <span className="complete-label"><Check size={13} /> Done</span>}
              {step.status === 'active' && <span className="step-state-label">Executing</span>}
              {step.status === 'failed' && <button className="approve-button" disabled={loading} onClick={() => onApprove(step.id)}><ShieldCheck size={14} /> Review again</button>}
            </div>
          </article>
        ))}
      </div>
      <div className="plan-card-footer">
        <span><LockKeyhole size={13} /> No messages or external services are touched.</span>
        <div>{hasUnsavedEdits && <span className="unsaved-label">Unsaved edits · save before approval</span>}<button className="save-plan-button" disabled={loading || !hasUnsavedEdits} onClick={onSave}>{loading ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />} Save plan</button></div>
      </div>
    </div>
  )
}

function HistoryTabs({ active, onChange }: { active: HistoryTab; onChange: (tab: HistoryTab) => void }) {
  const tabs: Array<{ id: HistoryTab; label: string }> = [
    { id: 'plans', label: 'Plans' }, { id: 'tasks', label: 'Tasks' }, { id: 'activity', label: 'Activity' },
  ]
  return <div className="history-tabs" role="tablist" aria-label="Task history type">{tabs.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={active === tab.id} className={active === tab.id ? 'active' : ''} onClick={() => onChange(tab.id)}>{tab.label}</button>)}</div>
}

function FeatureState({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return <div className="feature-state"><span className="feature-state-icon">{icon}</span><span className="feature-state-label">NOT ACTIVE IN THIS PROTOTYPE</span><h2>{title}</h2><p>{description}</p>{action}</div>
}

function ConnectionCard({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return <article className="connection-card"><span className="connection-card-icon">{icon}</span><span className="connection-card-copy"><strong>{title}</strong><span>{detail}</span></span><span className="not-connected-pill">Not connected</span></article>
}

function PageHeader({ icon, eyebrow, title, description, action }: { icon: ReactNode; eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-heading-row"><div><div className="page-icon-title"><span className="page-icon">{icon}</span><span className="eyebrow">{eyebrow}</span></div><h1>{title}</h1><p>{description}</p></div>{action}</div>
}

function EmptyState({ icon, title, text, action }: { icon: React.ReactNode; title: string; text: string; action?: React.ReactNode }) {
  return <div className="empty-state"><div className="empty-state-icon">{icon}</div><h2>{title}</h2><p>{text}</p>{action}</div>
}

export default App
