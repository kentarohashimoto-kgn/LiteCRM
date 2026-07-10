import { TasksNav } from "@/components/tasks/tasks-nav";

export default function TasksLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <TasksNav />
      {children}
    </div>
  );
}
