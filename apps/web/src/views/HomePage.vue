<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { Habit, Statistics, Task, TaskList, TaskPage, TaskStatus } from '@mvp/shared';
import { api, ApiError, auth, request } from '../api';
import TaskCard from '../components/TaskCard.vue';
import TaskEditor from '../components/TaskEditor.vue';
import '../workspace.css';
const router = useRouter();
const tab = ref<'tasks' | 'habits' | 'stats'>('tasks');
const view = ref<'list' | 'board'>('list');
const lists = ref<TaskList[]>([]), tasks = ref<Task[]>([]), habits = ref<Habit[]>([]);
const stats = ref<Statistics>({ total: 0, done: 0, overdue: 0, completionRate: 0, week: [] });
const search = ref(''), status = ref(''), listFilter = ref(''), sort = ref('created');
const page = ref(1), total = ref(0), pageSize = 12;
const loading = ref(true), busy = ref(false), error = ref(''), notice = ref('');
const selected = ref<string[]>([]), moveTarget = ref('');
const editor = ref(false), editingTask = ref<Task | null>(null);
const listName = ref(''), habitName = ref(''), showListForm = ref(false), listEditing = ref<string | null>(null);
const columns: { status: TaskStatus; label: string; symbol: string }[] = [{ status: 'todo', label: '待开始', symbol: '○' }, { status: 'doing', label: '进行中', symbol: '◐' }, { status: 'done', label: '已完成', symbol: '●' }];
const currentList = computed(() => lists.value.find(list => list.id === listFilter.value));
const defaultList = computed(() => lists.value.find(list => list.isDefault)?.id ?? '');
const pages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
const allSelected = computed(() => tasks.value.length > 0 && tasks.value.every(task => selected.value.includes(task.id)));
const week = computed(() => stats.value.week.map(day => ({ ...day, label: new Date(day.date + 'T12:00:00+08:00').toLocaleDateString('zh-CN', { weekday: 'short' }) })));
let generation = 0, searchTimer: ReturnType<typeof setTimeout>;
const dragging = ref<string | null>(null), dragOver = ref('');
function message(cause: unknown) { return cause instanceof Error ? cause.message : '操作失败，请重试'; }
async function load() {
  const ticket = ++generation;
  loading.value = true;
  const query = new URLSearchParams({ search: search.value, sort: sort.value, page: String(page.value), pageSize: String(pageSize) });
  if (status.value) query.set('status', status.value);
  if (listFilter.value) query.set('listId', listFilter.value);
  try {
    const [listData, taskData, habitData, statistics] = await Promise.all([
      api<{ lists: TaskList[] }>('lists'), api<TaskPage>(`tasks?${query}`), api<{ habits: Habit[] }>('habits'), api<Statistics>('statistics'),
    ]);
    if (ticket !== generation) return;
    lists.value = listData.lists; tasks.value = taskData.tasks; habits.value = habitData.habits; stats.value = statistics;
    total.value = taskData.total; page.value = taskData.page; selected.value = [];
  } catch (cause) {
    if (ticket !== generation) return;
    error.value = message(cause);
    if (cause instanceof ApiError && cause.status === 401) { auth.user = null; await router.replace('/login'); }
  } finally { if (ticket === generation) loading.value = false; }
}
async function mutate(action: () => Promise<unknown>, success: string) {
  if (busy.value) return false;
  busy.value = true; error.value = ''; notice.value = '';
  try { await action(); notice.value = success; await load(); return true; }
  catch (cause) { error.value = message(cause); return false; }
  finally { busy.value = false; }
}
watch([status, listFilter, sort], () => { page.value = 1; void load(); });
watch(search, () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { page.value = 1; void load(); }, 300); });
onMounted(load);
onUnmounted(() => { clearTimeout(searchTimer); generation++; });
function changePage(value: number) { page.value = value; void load(); }
function toggleSelection(id: string) { selected.value = selected.value.includes(id) ? selected.value.filter(value => value !== id) : [...selected.value, id]; }
function newTask() { editingTask.value = null; editor.value = true; }
function editTask(task: Task) { editingTask.value = task; editor.value = true; }
async function saveComplete() { editor.value = false; notice.value = '任务已保存'; await load(); }
async function removeTask(task: Task) {
  if (window.confirm(`删除“${task.title}”？此操作无法撤销。`)) await mutate(() => api(`tasks/${task.id}`, 'DELETE'), '任务已删除');
}
async function changeStatus(task: Task, value: TaskStatus) {
  const old = task.status;
  await mutate(async () => {
    task.status = value;
    try { await api(`tasks/${task.id}`, 'PATCH', { status: value }); }
    catch (cause) { task.status = old; throw cause; }
  }, '任务状态已更新');
}
function startDrag(task: Task, event: DragEvent) { if (busy.value) { event.preventDefault(); return; } dragging.value = task.id; event.dataTransfer?.setData('text/plain', task.id); if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'; }
async function drop(column: TaskStatus) { dragOver.value = ''; const task = tasks.value.find(task => task.id === dragging.value); dragging.value = null; if (task && task.status !== column) await changeStatus(task, column); }
async function batch(action: 'complete' | 'move' | 'delete') {
  if (!selected.value.length || (action === 'move' && !moveTarget.value)) return;
  if (action === 'delete' && !window.confirm(`删除选中的 ${selected.value.length} 个任务？此操作无法撤销。`)) return;
  await mutate(() => api('tasks/batch', 'POST', { ids: selected.value, action, ...(action === 'move' ? { listId: moveTarget.value } : {}) }), '批量操作已完成');
}
function openListForm(list?: TaskList) { listEditing.value = list?.id ?? null; listName.value = list?.name ?? ''; showListForm.value = true; }
async function saveList() {
  if (!listName.value.trim()) return;
  if (await mutate(() => api(listEditing.value ? `lists/${listEditing.value}` : 'lists', listEditing.value ? 'PATCH' : 'POST', { name: listName.value }), '清单已保存')) { showListForm.value = false; listName.value = ''; }
}
async function deleteList() {
  const list = currentList.value;
  if (!list || list.isDefault || !window.confirm(`删除“${list.name}”？其中的任务将移入默认清单。`)) return;
  await mutate(async () => { await api(`lists/${list.id}`, 'DELETE'); listFilter.value = ''; }, '清单已删除，任务已移入默认清单');
}
async function addHabit() { if (!habitName.value.trim()) return; if (await mutate(() => api('habits', 'POST', { name: habitName.value }), '新习惯已添加')) habitName.value = ''; }
async function check(habit: Habit) { await mutate(() => api(`habits/${habit.id}/check`, habit.checkedToday ? 'DELETE' : 'PUT'), habit.checkedToday ? '已撤销今天的打卡' : '今天也向前迈了一步！'); }
async function deleteHabit(habit: Habit) { if (window.confirm(`删除“${habit.name}”及其打卡记录？`)) await mutate(() => api(`habits/${habit.id}`, 'DELETE'), '习惯已删除'); }
async function signOut() {
  if (busy.value) return;
  busy.value = true; error.value = '';
  try { await request('logout', {}); generation++; auth.user = null; await router.replace('/login'); }
  catch (cause) { error.value = message(cause); }
  finally { busy.value = false; }
}
</script>

<template>
  <div v-if="auth.user" class="workspace">
    <aside class="workspace-sidebar">
      <RouterLink class="brand" to="/"><span class="brand-icon">L<span>•</span></span> launchpad<span class="brand-dot">®</span></RouterLink>
      <div class="sidebar-label">把想法，变成日常。</div>
      <nav class="main-nav" aria-label="工作空间"><button :class="{ active: tab === 'tasks' }" @click="tab = 'tasks'; listFilter = ''"><span>▤</span>全部任务 <small>{{ stats.total }}</small></button><button :class="{ active: tab === 'habits' }" @click="tab = 'habits'"><span>✳</span>习惯打卡 <small>{{ habits.length }}</small></button><button :class="{ active: tab === 'stats' }" @click="tab = 'stats'"><span>◷</span>数据概览</button></nav>
      <div class="sidebar-section-title">我的清单<button aria-label="新建清单" :disabled="busy" @click="openListForm()">＋</button></div>
      <nav class="list-nav" aria-label="清单"><button v-for="list in lists" :key="list.id" :class="{ active: listFilter === list.id && tab === 'tasks' }" @click="tab = 'tasks'; listFilter = list.id"><span class="list-dot"></span>{{ list.name }}<small>{{ list.count }}</small></button></nav>
      <form v-if="showListForm" class="list-form" @submit.prevent="saveList"><label for="list-name">{{ listEditing ? '修改清单名称' : '新建清单' }}</label><input id="list-name" v-model="listName" maxlength="40" required placeholder="清单名称" :disabled="busy"><div><button class="soft-button" type="button" :disabled="busy" @click="showListForm = false">取消</button><button class="solid-button" :disabled="busy">保存</button></div></form>
      <div class="sidebar-note"><span>✳</span><p>不用一次完成所有事。<br>今天，先迈出一小步。</p><small>SMALL STEPS. REAL PROGRESS.</small></div>
      <div class="sidebar-user"><span class="avatar avatar-small">{{ auth.user.name.slice(0, 1).toUpperCase() }}</span><div><strong>{{ auth.user.name }}</strong><small>个人工作空间</small></div><button class="icon-action" :disabled="busy" aria-label="退出登录" @click="signOut">↗</button></div>
    </aside>
    <main class="workspace-main">
      <header class="workspace-topbar"><span>个人空间 <span class="breadcrumb">/ {{ tab === 'tasks' ? '任务管理' : tab === 'habits' ? '习惯打卡' : '数据概览' }}</span></span><span class="topbar-date">{{ new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }) }}</span></header>
      <div class="workspace-content">
        <div class="workspace-eyebrow"><span class="status-dot"></span> A LITTLE EVERY DAY</div>
        <div class="page-heading"><div><h1>{{ tab === 'tasks' ? currentList?.name ?? '让每一步，都算数' : tab === 'habits' ? '把坚持，变成习惯' : '看见自己的进步' }}<span class="heading-dot">.</span></h1><p>{{ tab === 'tasks' ? '清空脑海里的待办，为重要的事留一点空间。' : tab === 'habits' ? '每天一点点，时间会给你答案。打卡按北京时间计算。' : '那些认真对待的小事，正在慢慢积累。' }}</p></div><button v-if="tab === 'tasks'" class="solid-button add-task" :disabled="busy || !lists.length" @click="newTask">＋ 新建任务</button></div>
        <div v-if="error" class="error-message workspace-alert" role="alert">{{ error }}<button class="text-button" @click="error = ''; load()">重新加载</button></div><div v-if="notice" class="success-message" role="status">✓ {{ notice }}<button class="icon-action" aria-label="关闭提示" @click="notice = ''">×</button></div>
        <div class="metric-grid"><article class="metric-card"><span>全部任务 <small>↗</small></span><strong>{{ stats.total.toString().padStart(2, '0') }}</strong><p>把想法安排下来</p></article><article class="metric-card"><span>已完成 <small>✓</small></span><strong>{{ stats.done.toString().padStart(2, '0') }}</strong><p>每一个完成都值得记录</p></article><article class="metric-card"><span>逾期任务 <small>◷</small></span><strong :class="{ 'overdue-text': stats.overdue }">{{ stats.overdue.toString().padStart(2, '0') }}</strong><p>给这些任务多一点关注</p></article><article class="metric-card rate-card"><span>任务完成率 <small>✳</small></span><strong>{{ stats.completionRate }}<em>%</em></strong><div class="progress-track"><i :style="{ width: stats.completionRate + '%' }"></i></div></article></div>
        <section v-if="tab === 'tasks'" class="tasks-section" aria-label="任务管理">
          <div class="section-toolbar"><div class="view-tabs"><button :class="{ active: view === 'list' }" @click="view = 'list'">☷ 列表</button><button :class="{ active: view === 'board' }" @click="view = 'board'">▥ 看板</button></div><div v-if="currentList && !currentList.isDefault" class="list-actions"><button class="text-button" :disabled="busy" @click="openListForm(currentList)">重命名清单</button><button class="text-button danger" :disabled="busy" @click="deleteList">删除清单</button></div><span class="result-count">{{ total }} 项任务</span></div>
          <div class="filter-bar"><div class="search-wrap"><span>⌕</span><input v-model="search" aria-label="搜索任务标题" placeholder="搜索任务标题…" maxlength="120"></div><select v-model="status" aria-label="筛选任务状态"><option value="">全部状态</option><option value="todo">待开始</option><option value="doing">进行中</option><option value="done">已完成</option></select><select v-model="sort" aria-label="任务排序"><option value="created">最近创建</option><option value="due">截止时间优先</option></select></div>
          <div class="selection-bar"><label><input type="checkbox" :checked="allSelected" :disabled="busy || loading || !tasks.length" @change="selected = allSelected ? [] : tasks.map(task => task.id)"> 选择本页</label><template v-if="selected.length"><span>已选 {{ selected.length }} 项</span><button :disabled="busy" @click="batch('complete')">完成</button><select v-model="moveTarget" aria-label="批量移动目标清单"><option value="">移到清单…</option><option v-for="list in lists" :key="list.id" :value="list.id">{{ list.name }}</option></select><button :disabled="busy || !moveTarget" @click="batch('move')">移动</button><button class="danger" :disabled="busy" @click="batch('delete')">删除</button></template><span v-else class="selection-hint">{{ view === 'board' ? '拖动任务卡片，更新进度' : '选中任务，可批量完成、移动或删除' }}</span></div>
          <div v-if="loading" class="loading-state" role="status">正在整理你的工作空间…</div>
          <div v-else-if="!tasks.length" class="empty-state"><span>✳</span><h3>{{ search || status ? '这里暂时没有匹配的任务' : '给今天一个小小的开始' }}</h3><p>{{ search || status ? '试试其他关键词，或调整筛选条件。' : '把脑海里的第一件事记下来，然后慢慢完成。' }}</p><button class="soft-button" @click="newTask">＋ 新建任务</button></div>
          <div v-else-if="view === 'list'" class="task-list"><TaskCard v-for="task in tasks" :key="task.id" :task="task" :lists="lists" :selected="selected.includes(task.id)" :busy="busy" @select="toggleSelection(task.id)" @edit="editTask(task)" @remove="removeTask(task)" @status="changeStatus(task, $event)" @drag="startDrag(task, $event)" /></div>
          <div v-else class="kanban-board" @dragend="dragging = null; dragOver = ''"><section v-for="column in columns" :key="column.status" class="kanban-column" :class="{ 'drag-over': dragOver === column.status }" @dragover.prevent="dragOver = column.status" @dragleave.self="dragOver = ''" @drop.prevent="drop(column.status)"><div class="column-heading" :class="column.status"><span>{{ column.symbol }} {{ column.label }}</span><small>{{ tasks.filter(task => task.status === column.status).length }}</small></div><TaskCard v-for="task in tasks.filter(task => task.status === column.status)" :key="task.id" :task="task" :lists="lists" :selected="selected.includes(task.id)" :busy="busy" @select="toggleSelection(task.id)" @edit="editTask(task)" @remove="removeTask(task)" @status="changeStatus(task, $event)" @drag="startDrag(task, $event)" /><div v-if="!tasks.some(task => task.status === column.status)" class="column-empty">拖动任务到这里</div></section></div>
          <footer class="pagination"><span>共 {{ total }} 项 · 每页 {{ pageSize }} 项{{ view === 'board' ? ' · 看板显示当前页' : '' }}</span><div><button class="soft-button" :disabled="loading || busy || page <= 1" @click="changePage(page - 1)">← 上一页</button><span>{{ page }} / {{ pages }}</span><button class="soft-button" :disabled="loading || busy || page >= pages" @click="changePage(page + 1)">下一页 →</button></div></footer>
        </section>
        <section v-else-if="tab === 'habits'" class="habits-section"><div class="section-title"><h2>我的每日习惯</h2><span>ONE DAY AT A TIME</span></div><form class="habit-create" @submit.prevent="addHabit"><input v-model="habitName" maxlength="80" required placeholder="想养成什么好习惯？比如：每天阅读 20 分钟" aria-label="新习惯名称" :disabled="busy"><button class="solid-button" :disabled="busy">＋ 添加习惯</button></form><div v-if="loading" class="loading-state">正在加载习惯…</div><div v-else-if="!habits.length" class="empty-state"><span>✳</span><h3>好的改变，从一个小习惯开始</h3><p>在上方添加你的第一个每日习惯。</p></div><div v-else class="habit-grid"><article v-for="habit in habits" :key="habit.id" class="habit-card"><div class="habit-heading"><span class="habit-symbol">✳</span><button class="icon-action" :disabled="busy" :aria-label="`删除习惯：${habit.name}`" @click="deleteHabit(habit)">×</button></div><h3>{{ habit.name }}</h3><p>累计坚持 <strong>{{ habit.totalDays }}</strong> 天</p><div class="habit-week"><div v-for="day in week" :key="day.date"><small>{{ day.label }}</small><span :class="{ checked: habit.days.includes(day.date) }" :title="day.date + (habit.days.includes(day.date) ? ' 已打卡' : ' 未打卡')">{{ habit.days.includes(day.date) ? '✓' : '·' }}</span></div></div><button class="habit-check" :class="{ checked: habit.checkedToday }" :disabled="busy" @click="check(habit)">{{ habit.checkedToday ? '✓ 今日已打卡 · 点击撤销' : '＋ 完成今日打卡' }}</button></article></div></section>
        <section v-else class="statistics-section"><article class="chart-panel"><div class="section-title"><h2>最近七天的坚持</h2><span>HABIT CHECK-INS</span></div><p>每天完成的习惯打卡数 · 北京时间</p><div class="bar-chart" role="img" :aria-label="week.map(day => `${day.date}：${day.count} 次打卡`).join('，')"><div v-for="day in week" :key="day.date" class="bar-column"><strong>{{ day.count }}</strong><div class="bar-track"><i :style="{ height: Math.max(3, day.count / Math.max(1, ...week.map(d => d.count)) * 100) + '%' }"></i></div><span>{{ day.label }}</span><small>{{ day.date.slice(5) }}</small></div></div></article><article class="progress-panel"><span class="form-kicker">A WORK IN PROGRESS</span><h2>每一步，<br>都在靠近目标。</h2><div class="completion-ring" :style="{ background: `conic-gradient(#195b47 ${stats.completionRate}%, #e3e8d9 0)` }"><span>{{ stats.completionRate }}<small>%</small></span></div><p>已完成 {{ stats.done }} / {{ stats.total }} 项任务</p><button class="soft-button" @click="tab = 'tasks'">继续我的任务 ↗</button></article></section>
        <footer class="workspace-footer"><span>© {{ new Date().getFullYear() }} Launchpad</span><span>Small steps, real progress. ↗</span></footer>
      </div>
    </main>
    <TaskEditor v-if="editor" :task="editingTask" :lists="lists" :default-list="listFilter || defaultList" @close="editor = false" @saved="saveComplete" />
  </div>
</template>
