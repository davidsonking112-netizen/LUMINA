import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import {
  Activity, ArrowDown, ArrowRight, BookOpen, CalendarClock, Check, CheckCheck,
  CircleHelp, Clock3, FileText, FileSearch, FolderOpen, Globe2, LoaderCircle, LockKeyhole, Menu, MessageSquare,
  ListTodo, MoreHorizontal, Plus, Search, Send, Settings2, ShieldCheck, Sparkles, SquarePen,
  Trash2, Upload, Workflow, X,
} from 'lucide-react'
import { api } from './api'
import type { AuditEvent, Automation, Connector, DocumentAsset, ForgeTask, MemoryEntry, Plan, ResearchReport } from './types'
import './App.css'
import './feature.css'

type Section = 'chat' | 'plans' | 'tasks' | 'memory' | 'activity' | 'automations' | 'library' | 'research' | 'connectors' | 'settings'
type Toast = { id: number; text: string; kind: 'success' | 'error' }

const navigation: Array<{ id: Section; label: string; icon: typeof MessageSquare }> = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'plans', label: 'Plans', icon: ListTodo },
  { id: 'tasks', label: 'Tasks', icon: CheckCheck },
  { id: 'memory', label: 'Memory', icon: BookOpen },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'automations', label: 'Automations', icon: Workflow },
  { id: 'library', label: 'Files & documents', icon: FolderOpen },
  { id: 'research', label: 'Research', icon: Globe2 },
  { id: 'connectors', label: 'Connected apps', icon: CalendarClock },
  { id: 'settings', label: 'Settings', icon: Settings2 },
]

function formatDate(value: string) {
  return new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function App() {
  const [section, setSection] = useState<Section>('chat')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [plans, setPlans] = useState<Plan[]>([])
  const [currentPlanId, setCurrentPlanId] = useState('')
  const [dirtyPlanIds, setDirtyPlanIds] = useState<Set<string>>(() => new Set())
  const [tasks, setTasks] = useState<ForgeTask[]>([])
  const [memories, setMemories] = useState<MemoryEntry[]>([])
  const [activity, setActivity] = useState<AuditEvent[]>([])
  const [automations, setAutomations] = useState<Automation[]>([])
  const [documents, setDocuments] = useState<DocumentAsset[]>([])
  const [connectors, setConnectors] = useState<Connector[]>([])
  const [researchReport, setResearchReport] = useState<ResearchReport | null>(null)
  const [researchQuestion, setResearchQuestion] = useState('')
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
      const [taskRows, memoryRows, activityRows, planRows, automationRows, documentRows, connectorRows] = await Promise.all([api.tasks(), api.memories(), api.activity(), api.plans(), api.automations(), api.documents(), api.connectors()])
      setTasks(taskRows)
      setMemories(memoryRows)
      setActivity(activityRows)
      setPlans(planRows)
      setAutomations(automationRows)
      setDocuments(documentRows)
      setConnectors(connectorRows)
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

  async function toggleAutomation(automation: Automation) {
    try {
      const updated = await api.toggleAutomation(automation.id, !automation.enabled)
      setAutomations((items) => items.map((item) => item.id === updated.id ? { ...item, enabled: updated.enabled } : item))
      await refreshActivity()
      toast(`${automation.name} ${updated.enabled ? 'enabled' : 'paused'}.`)
    } catch (err) { toast(err instanceof Error ? err.message : 'Could not update automation.', 'error') }
  }

  async function runResearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (researchQuestion.trim().length < 2 || loading) return
    setLoading(true)
    try { setResearchReport(await api.research(researchQuestion)); await refreshActivity(); toast('Research request prepared with source tracking.') }
    catch (err) { toast(err instanceof Error ? err.message : 'Could not prepare research.', 'error') }
    finally { setLoading(false) }
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

  const title = navigation.find((item) => item.id === section)?.label ?? 'Chat'

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNavOpen ? 'sidebar-open' : ''}`} aria-label="Main navigation">
        <div className="brand-row">
          <div className="brand-mark" aria-hidden="true"><span>F</span><i /></div>
          <div className="brand-copy"><strong>Forge</strong><span>Personal agent</span></div>
          <button className="icon-button mobile-close" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)}><X size={18} /></button>
        </div>
        <button className="new-chat-button" onClick={() => { setSection('chat'); setCurrentPlanId(''); setMobileNavOpen(false) }}><SquarePen size={17} /> New chat</button>
        <div className="nav-label">Workspace</div>
        <nav className="primary-nav">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`nav-item ${section === id ? 'active' : ''}`} aria-current={section === id ? 'page' : undefined} onClick={() => { setSection(id); setMobileNavOpen(false) }}>
              <Icon size={18} strokeWidth={1.8} /><span>{label}</span>{id === 'tasks' && tasks.length > 0 && <span className="nav-count">{tasks.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-card"><LockKeyhole size={15} /><div><strong>Private workspace</strong><span>Stored on this device</span></div></div>
          <div className="user-card"><div className="avatar">D</div><div><strong>Davids</strong><span>Personal workspace</span></div><MoreHorizontal size={18} className="user-more" /></div>
        </div>
      </aside>

      {mobileNavOpen && <button className="mobile-backdrop" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}

      <main className="main-shell">
        <header className="topbar">
          <div className="topbar-left"><button className="icon-button menu-button" aria-label="Open navigation" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(true)}><Menu size={19} /></button><span className="breadcrumb">Workspace</span><ArrowRight size={14} className="breadcrumb-arrow" /><span className="breadcrumb-current">{title}</span></div>
          <div className="topbar-right"><span className={`connection-pill ${ready ? 'online' : 'offline'}`}><i />{ready ? 'Local service connected' : 'Connecting'}</span><button className="help-button" aria-label="About this prototype" onClick={() => setSection('settings')}><CircleHelp size={18} /></button></div>
        </header>

        <div className="main-scroll">
          {error && <div className="error-banner" role="alert"><CircleHelp size={17} /><span>{error}</span><button onClick={() => void refreshData()}>Retry</button></div>}
          {section === 'chat' && <section className="chat-layout">
            <div className="chat-column">
              <div className="chat-heading"><div className="forge-orb"><Sparkles size={20} /></div><div><p className="eyebrow">YOUR PERSONAL AGENT</p><h1>What’s on your mind?</h1><p className="heading-subtitle">Tell Forge what you need to get done. You’ll see the plan before anything happens.</p></div></div>
              {currentPlan ? <div className="conversation-block">
                <div className="message-bubble user-bubble"><span className="message-label">YOU</span><p>{currentPlan.request}</p></div>
                <div className="agent-message"><div className="agent-avatar"><Sparkles size={15} /></div><div className="agent-message-body"><div className="agent-name-row"><strong>Forge</strong><span>Plan draft · no action has run</span></div><PlanCard plan={currentPlan} loading={loading} hasUnsavedEdits={dirtyPlanIds.has(currentPlan.id)} onTitleChange={updateStepTitle} onSave={() => void savePlan(currentPlan)} onApprove={(stepId) => void approveStep(currentPlan, stepId)} onDeny={(stepId) => void denyStep(currentPlan, stepId)} onExecute={(stepId) => void executeStep(currentPlan, stepId)} /></div></div>
              </div> : <div className="empty-prompt"><div className="empty-prompt-icon"><MessageSquare size={19} /></div><p>Start with one thing you want to move forward.</p><span>Forge will turn it into a clear, editable plan first.</span></div>}
              <form className="composer" onSubmit={createPlan}>
                <label className="sr-only" htmlFor="request">Message Forge</label>
                <textarea id="request" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={handleComposerKey} maxLength={2000} placeholder="Ask Forge to help with something…" rows={3} />
                <div className="composer-footer"><div className="composer-hint"><span className="composer-sparkle"><Sparkles size={14} /></span><span>Plans are editable. Actions wait for your approval.</span></div><div className="composer-actions"><span>{draft.length}/2,000</span><button className="send-button" type="submit" disabled={loading || draft.trim().length < 2}>{loading ? <LoaderCircle className="spin" size={17} /> : <Send size={16} />}<span>Plan it</span></button></div></div>
              </form>
              <p className="prototype-note">Without a model provider, plans use simple local parsing. With one configured, your request text is sent there to draft a plan. This build creates local tasks only; email, calendar, web, voice and file actions aren’t connected.</p>
            </div>
            <aside className="right-rail"><div className="rail-card"><div className="rail-card-heading"><div className="rail-icon"><ShieldCheck size={17} /></div><strong>Your control comes first</strong></div><p>Review each action before it runs. Editing a plan clears any earlier approval.</p><div className="rail-divider" /><div className="rail-meta-row"><span>Current mode</span><strong>Review every action</strong></div><div className="rail-meta-row"><span>Approval window</span><strong>10 minutes</strong></div></div><div className="rail-card quick-card"><div className="quick-card-title"><Clock3 size={16} /><strong>Today so far</strong></div><div className="quick-stats"><div><strong>{tasks.length}</strong><span>tasks</span></div><div><strong>{activity.length}</strong><span>activity events</span></div></div><button className="text-link" onClick={() => setSection('activity')}>View activity <ArrowRight size={14} /></button></div><div className="rail-disclosure"><LockKeyhole size={14} /><span>This prototype stores data locally on this device. Don’t save secrets here.</span></div></aside>
          </section>}

          {section === 'tasks' && <section className="page-view"><PageHeader icon={<CheckCheck size={19} />} eyebrow="YOUR WORKSPACE" title="Tasks" description="Things Forge has created after your approval." />
            <div className="list-toolbar"><label className="search-field"><Search size={16} /><input aria-label="Search tasks" placeholder="Search tasks" value={searchText} onChange={(event) => setSearchText(event.target.value)} />{searchText && <button aria-label="Clear search" onClick={() => setSearchText('')}><X size={14} /></button>}</label><span className="result-count">{filteredTasks.length} {filteredTasks.length === 1 ? 'task' : 'tasks'}</span></div>
            {filteredTasks.length ? <div className="item-list">{filteredTasks.map((task) => <article className="list-card task-card" key={task.id}><div className="task-check"><Check size={16} /></div><div className="list-card-main"><strong>{task.title}</strong><span>Created {formatDate(task.createdAt)}</span></div><button className="icon-button danger-hover" aria-label={`Delete ${task.title}`} onClick={() => void deleteTask(task)}><Trash2 size={16} /></button></article>)}</div> : <EmptyState icon={<CheckCheck size={20} />} title={searchText ? 'No tasks match that search' : 'No tasks yet'} text={searchText ? 'Try a shorter search.' : 'When you approve a plan step, its task will show up here.'} />}
          </section>}

          {section === 'plans' && <section className="page-view">
            <PageHeader icon={<ListTodo size={19} />} eyebrow="YOUR PLAN HISTORY" title="Plans" description="Review saved requests and manage their local records." />
            <div className="list-toolbar"><label className="search-field"><Search size={16} /><input aria-label="Search plans" placeholder="Search plans" value={searchText} onChange={(event) => setSearchText(event.target.value)} />{searchText && <button aria-label="Clear search" onClick={() => setSearchText('')}><X size={14} /></button>}</label><span className="result-count">{filteredPlans.length} {filteredPlans.length === 1 ? 'plan' : 'plans'}</span></div>
            {filteredPlans.length ? <div className="plan-history-list">{filteredPlans.map((plan) => <article className="plan-history-card" key={plan.id}><div className="plan-history-icon"><ListTodo size={16} /></div><div className="plan-history-main"><strong>{plan.request}</strong><span>{plan.steps.length} {plan.steps.length === 1 ? 'step' : 'steps'} · {plan.status.replace('_', ' ')} · Updated {formatDate(plan.updatedAt)}</span></div><button className="secondary-button" onClick={() => { setCurrentPlanId(plan.id); setSection('chat') }}>Open plan</button><button className="icon-button danger-hover" aria-label="Delete plan and linked local tasks" onClick={() => void deletePlan(plan)}><Trash2 size={16} /></button></article>)}</div> : <EmptyState icon={<ListTodo size={20} />} title={searchText ? 'No plans match that search' : 'No saved plans yet'} text={searchText ? 'Try a shorter search.' : 'When you ask Forge to plan something, you’ll find the saved request here.'} />}
          </section>}

          {section === 'memory' && <section className="page-view"><PageHeader icon={<BookOpen size={19} />} eyebrow="YOUR CONTEXT" title="Memory" description="Only details you add here are saved. Edit or forget them whenever you like." action={<button className="primary-button" onClick={() => openMemory('new')}><Plus size={16} /> Add memory</button>} />
            <div className="memory-disclosure"><LockKeyhole size={16} /><p><strong>Owner-added only.</strong> These notes are stored on this device and aren’t used to personalize anything in this prototype yet.</p></div>
            <div className="list-toolbar"><label className="search-field"><Search size={16} /><input aria-label="Search memories" placeholder="Search memories" value={searchText} onChange={(event) => setSearchText(event.target.value)} />{searchText && <button aria-label="Clear search" onClick={() => setSearchText('')}><X size={14} /></button>}</label><span className="result-count">{filteredMemories.length} saved</span></div>
            {filteredMemories.length ? <div className="memory-grid">{filteredMemories.map((entry) => <article className="memory-card" key={entry.id}><div className="memory-card-top"><span className="memory-source"><span className="source-dot" /> You added this</span><button className="icon-button" aria-label={`More actions for ${entry.title}`} onClick={() => openMemory(entry)}><MoreHorizontal size={17} /></button></div><h2>{entry.title}</h2><p>{entry.content}</p><div className="memory-card-footer"><span>Updated {formatDate(entry.updatedAt)}</span><div><button onClick={() => openMemory(entry)}>Edit</button><button className="danger-link" onClick={() => void deleteMemory(entry)}>Forget</button></div></div></article>)}</div> : <EmptyState icon={<BookOpen size={20} />} title={searchText ? 'No memories match that search' : 'Your memory starts with you'} text={searchText ? 'Try a shorter search.' : 'Add a preference or detail you want to keep nearby. You’re in control of every note.'} action={!searchText ? <button className="primary-button" onClick={() => openMemory('new')}><Plus size={16} /> Add a memory</button> : undefined} />}
          </section>}

          {section === 'activity' && <section className="page-view"><PageHeader icon={<Activity size={19} />} eyebrow="TRANSPARENCY" title="Activity" description="A clear record of what Forge planned, what you approved, and what happened." />
            <div className="audit-notice"><ShieldCheck size={17} /><span>Activity shows request/task details from records still saved on this device. Delete a plan to remove those details; its generic approval and outcome history remains. Export first if you want to keep a detailed copy.</span></div>
            {activity.length ? <div className="timeline">{activity.map((event) => <article className="timeline-item" key={event.id}><div className={`timeline-dot ${event.eventType.includes('failed') ? 'failed' : ''}`} /><div className="timeline-card"><div className="timeline-header"><strong>{event.summary}</strong><time>{formatDate(event.occurredAt)}</time></div>{event.context && <p className="event-context">{event.context}</p>}{event.detailsRemoved && <span className="event-redacted"><LockKeyhole size={12} /> Details removed</span>}<span className="event-kind">{event.eventType.replaceAll('.', ' · ')}</span></div></article>)}</div> : <EmptyState icon={<Activity size={20} />} title="Nothing has happened yet" text="Once you draft a plan, this timeline will show it here." />}
          </section>}

          {section === 'automations' && <section className="page-view"><PageHeader icon={<Workflow size={19} />} eyebrow="PROACTIVE WORK" title="Automations" description="Schedule briefings, reports and alerts. Every workflow has its own permission mode." action={<button className="primary-button" onClick={() => toast('Automation builder is ready for a trigger, action and permission mode.') }><Plus size={16} /> New automation</button>} />
            <div className="feature-banner"><Workflow size={17} /><div><strong>Build once, stay in control</strong><span>Suggest mode prepares work. Approve mode pauses before important actions. Automatic mode is reserved for trusted workflows.</span></div></div>
            <div className="automation-list">{automations.map((automation) => <article className="automation-card" key={automation.id}><div className="automation-icon"><CalendarClock size={18} /></div><div className="automation-main"><div className="automation-title"><strong>{automation.name}</strong><span className={automation.enabled ? 'status-on' : 'status-off'}>{automation.enabled ? 'Active' : 'Paused'}</span></div><p>{automation.description}</p><div className="automation-meta"><span>{automation.trigger}</span><span>{automation.permissionMode} mode</span><span>{automation.actionSummary}</span></div></div><button className={automation.enabled ? 'secondary-button' : 'primary-button'} onClick={() => void toggleAutomation(automation)}>{automation.enabled ? 'Pause' : 'Enable'}</button></article>)}</div>
          </section>}

          {section === 'library' && <section className="page-view"><PageHeader icon={<FolderOpen size={19} />} eyebrow="WORKSPACE LIBRARY" title="Files & documents" description="Transform PDFs, Word files, spreadsheets, presentations, images, audio, transcripts and CSV data." action={<button className="primary-button" onClick={() => toast('Choose a workspace folder in Manus Studio to add local files.') }><Upload size={16} /> Add files</button>} />
            <div className="format-strip"><span><FileText size={15} /> PDF / DOCX / PPTX</span><span><FileSearch size={15} /> Search & summarize</span><span><Workflow size={15} /> Convert to actions</span></div>
            <div className="document-grid">{documents.map((document) => <article className="document-card" key={document.id}><div className="document-top"><div className="document-type">{document.type.toUpperCase()}</div><span className="status-on">Ready</span></div><h2>{document.name}</h2><p>{document.size} · Updated {formatDate(document.updatedAt)}</p><div className="capability-tags">{document.capabilities.map((capability) => <span key={capability}>{capability}</span>)}</div></article>)}</div>
            <div className="empty-state compact-empty"><FileSearch size={20} /><h2>Drop in a contract, meeting transcript or spreadsheet</h2><p>Forge will extract useful structure, cite the source file and ask before creating or sharing anything.</p></div>
          </section>}

          {section === 'research' && <section className="page-view"><PageHeader icon={<Globe2 size={19} />} eyebrow="EVIDENCE WORKSPACE" title="Research" description="Ask a question, compare sources, separate facts from assumptions, and keep a cited report." />
            <form className="research-box" onSubmit={runResearch}><textarea value={researchQuestion} onChange={(event) => setResearchQuestion(event.target.value)} placeholder="What should Forge research? e.g. Compare three competitors and cite the sources." rows={3} /><div className="research-footer"><span><Globe2 size={14} /> Source tracking is always on</span><button className="primary-button" disabled={loading || researchQuestion.trim().length < 2}>{loading ? <LoaderCircle className="spin" size={15} /> : <Search size={15} />} Prepare research</button></div></form>
            {researchReport ? <article className="research-report"><div className="report-label"><Check size={14} /> Report prepared · {formatDate(researchReport.createdAt)}</div><h2>{researchReport.question}</h2><p>{researchReport.answer}</p><div className="assumption-box"><strong>Assumptions</strong>{researchReport.assumptions.map((assumption) => <span key={assumption}>• {assumption}</span>)}</div><h3>Sources</h3>{researchReport.sources.map((source) => <div className="source-row" key={source.id}><div><strong>{source.title}</strong><span>{source.publisher} · {source.confidence} confidence</span></div><span>{source.excerpt}</span></div>)}</article> : <EmptyState icon={<Globe2 size={20} />} title="Research with receipts" text="Your next report will show the answer, assumptions and source excerpts in one place." />}
          </section>}

          {section === 'connectors' && <section className="page-view"><PageHeader icon={<CalendarClock size={19} />} eyebrow="TOOLS & SERVICES" title="Connected apps" description="Connect the tools Forge can use. Permissions are scoped and high-impact actions still require approval." /><div className="connector-grid">{connectors.map((connector) => <article className="connector-card" key={connector.id}><div className="connector-top"><div className="connector-icon"><Sparkles size={17} /></div><span className={`connector-status ${connector.status}`}>{connector.status.replace('_', ' ')}</span></div><h2>{connector.name}</h2><p>{connector.description}</p><div className="scope-list">{connector.scopes.map((scope) => <span key={scope}>{scope}</span>)}</div><button className="secondary-button" onClick={() => toast(connector.status === 'coming_soon' ? `${connector.name} connector is staged for setup.` : `${connector.name} is available in this workspace.`)}>{connector.status === 'connected' ? 'Manage access' : 'Configure'}</button></article>)}</div></section>}

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
  return (
    <div className="plan-card">
      <div className="plan-card-header">
        <div>
          <div className="plan-kicker"><Sparkles size={14} /> {plan.generationMode === 'ai' ? 'AI-ASSISTED DRAFT' : 'BASIC LOCAL DRAFT'}</div>
          <h2>Here’s a first pass</h2>
          <p>Each step below only creates a local task. Review the exact title before approving.</p>
        </div>
        <span className={`plan-status ${plan.status}`}>{plan.status.replace('_', ' ')}</span>
      </div>
      <div className="steps-list">
        {plan.steps.map((step, index) => (
          <article className={`plan-step ${step.status}`} key={step.id}>
            <div className="step-index">{step.status === 'done' ? <Check size={14} /> : index + 1}</div>
            <div className="step-content">
              <label className="sr-only" htmlFor={`step-${step.id}`}>Task title for step {index + 1}</label>
              <input id={`step-${step.id}`} value={step.taskTitle} maxLength={120} onChange={(event) => onTitleChange(plan.id, step.id, event.target.value)} disabled={step.status === 'done'} />
              <p>{step.detail}</p>
              {step.status === 'approved' && step.expiresAt && <span className="approval-expiry"><Clock3 size={13} /> Approved until {formatDate(step.expiresAt)}</span>}
              {step.status === 'denied' && <span className="denied-note">Declined. No task was created.</span>}
            </div>
            <div className="step-controls">
              {step.status === 'pending' && <>
                <button className="approve-button" disabled={loading || hasUnsavedEdits || step.taskTitle.trim().length < 2} onClick={() => onApprove(step.id)}><ShieldCheck size={14} /> Approve</button>
                <button className="quiet-button" disabled={loading || hasUnsavedEdits} onClick={() => onDeny(step.id)}>Decline</button>
              </>}
              {step.status === 'approved' && <button className="run-button" disabled={loading || hasUnsavedEdits} onClick={() => onExecute(step.id)}>{loading ? <LoaderCircle className="spin" size={14} /> : <ArrowDown size={14} />} Run task</button>}
              {step.status === 'done' && <span className="complete-label"><Check size={13} /> Done</span>}
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

function PageHeader({ icon, eyebrow, title, description, action }: { icon: ReactNode; eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-heading-row"><div><div className="page-icon-title"><span className="page-icon">{icon}</span><span className="eyebrow">{eyebrow}</span></div><h1>{title}</h1><p>{description}</p></div>{action}</div>
}

function EmptyState({ icon, title, text, action }: { icon: React.ReactNode; title: string; text: string; action?: React.ReactNode }) {
  return <div className="empty-state"><div className="empty-state-icon">{icon}</div><h2>{title}</h2><p>{text}</p>{action}</div>
}

export default App
