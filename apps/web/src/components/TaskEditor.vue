<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { taskSchema, type Task, type TaskList } from '@mvp/shared';
import { api } from '../api';
const props = defineProps<{ task: Task | null; lists: TaskList[]; defaultList: string }>();
const emit = defineEmits<{ close: []; saved: [] }>();
const dialog = ref<HTMLDialogElement>();
const title = ref(props.task?.title ?? '');
const description = ref(props.task?.description ?? '');
const status = ref(props.task?.status ?? 'todo');
const listId = ref(props.task?.listId ?? props.defaultList);
function localDate(value: string) { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
const dueAt = ref(props.task?.dueAt ? localDate(props.task.dueAt) : '');
const busy = ref(false), error = ref('');
onMounted(() => dialog.value?.showModal());
async function save() {
  if (busy.value) return;
  error.value = '';
  const parsed = taskSchema.safeParse({ title: title.value, description: description.value, status: status.value, listId: listId.value, dueAt: dueAt.value ? new Date(dueAt.value).toISOString() : null });
  if (!parsed.success) { error.value = parsed.error.issues[0].message; return; }
  busy.value = true;
  try { await api(props.task ? `tasks/${props.task.id}` : 'tasks', props.task ? 'PATCH' : 'POST', parsed.data); emit('saved'); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '保存失败'; }
  finally { busy.value = false; }
}
</script>
<template>
  <dialog ref="dialog" class="workspace-dialog" aria-labelledby="editor-title" @cancel.prevent="!busy && emit('close')">
    <form @submit.prevent="save"><div class="dialog-heading"><div><span class="form-kicker">MAKE IT HAPPEN</span><h2 id="editor-title">{{ task ? '编辑任务' : '安排一件小事' }}</h2></div><button type="button" class="icon-action" aria-label="关闭" :disabled="busy" @click="emit('close')">×</button></div>
      <fieldset :disabled="busy"><label>任务标题<input v-model="title" autofocus maxlength="120" required placeholder="接下来，你想完成什么？"></label><label>描述<textarea v-model="description" maxlength="4000" rows="4" placeholder="写下一些细节，让行动更清晰…"></textarea></label><div class="form-row"><label>所属清单<select v-model="listId" required><option v-for="list in lists" :key="list.id" :value="list.id">{{ list.name }}</option></select></label><label>状态<select v-model="status"><option value="todo">待开始</option><option value="doing">进行中</option><option value="done">已完成</option></select></label></div><label>截止时间（可选）<input v-model="dueAt" type="datetime-local"></label></fieldset>
      <div v-if="error" class="error-message" role="alert">{{ error }}</div><div class="dialog-footer"><button type="button" class="soft-button" :disabled="busy" @click="emit('close')">取消</button><button class="solid-button" :disabled="busy">{{ busy ? '保存中…' : '保存任务 ↗' }}</button></div>
    </form>
  </dialog>
</template>
