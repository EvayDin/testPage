<script setup lang="ts">
import type { Task, TaskList, TaskStatus } from '@mvp/shared';
defineProps<{ task: Task; lists: TaskList[]; selected: boolean; busy: boolean }>();
defineEmits<{ select: []; edit: []; remove: []; status: [value: TaskStatus]; drag: [event: DragEvent] }>();
</script>
<template>
  <article class="task-card" :class="{ completed: task.status === 'done', selected }" :draggable="!busy" @dragstart="$emit('drag', $event)">
    <div class="task-card-top"><input type="checkbox" :checked="selected" :disabled="busy" :aria-label="`选择任务：${task.title}`" @change="$emit('select')"><span class="list-chip">{{ lists.find(l => l.id === task.listId)?.name }}</span><span v-if="task.overdue" class="overdue-label">已逾期</span><button class="icon-action" :disabled="busy" :aria-label="`编辑任务：${task.title}`" @click="$emit('edit')">↗</button></div>
    <button class="task-title" :disabled="busy" @click="$emit('edit')">{{ task.title }}</button>
    <p v-if="task.description" class="task-description">{{ task.description }}</p>
    <div class="task-card-bottom"><span :class="{ 'overdue-text': task.overdue }">{{ task.dueAt ? '◷ ' + new Date(task.dueAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '无截止时间' }}</span><select :value="task.status" :disabled="busy" :aria-label="`任务状态：${task.title}`" @change="$emit('status', ($event.target as HTMLSelectElement).value as TaskStatus)"><option value="todo">待开始</option><option value="doing">进行中</option><option value="done">已完成</option></select><button class="icon-action delete-action" :disabled="busy" :aria-label="`删除任务：${task.title}`" @click="$emit('remove')">×</button></div>
  </article>
</template>
