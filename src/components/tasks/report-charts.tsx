"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";

const TEAL = "#008C8C";
const ORANGE = "#F59A2A";
const LIGHT = "#B7E3DD";

export interface WeeklyPoint {
  label: string;
  completed: number;
  created: number;
}
export interface AssigneePoint {
  label: string;
  open: number;
  done: number;
}

export function WeeklyChart({ data }: { data: WeeklyPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E7ECEC" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#6b7a7a" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "#6b7a7a" }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e5e7eb", fontSize: 12 }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="created" name="作成" fill={LIGHT} radius={[4, 4, 0, 0]} />
        <Bar dataKey="completed" name="完了" fill={TEAL} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function AssigneeChart({ data }: { data: AssigneePoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 42)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E7ECEC" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11, fill: "#6b7a7a" }} axisLine={false} tickLine={false} allowDecimals={false} />
        <YAxis type="category" dataKey="label" tick={{ fontSize: 11, fill: "#6b7a7a" }} axisLine={false} tickLine={false} width={80} />
        <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e5e7eb", fontSize: 12 }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="done" name="完了" stackId="a" fill={TEAL} radius={[4, 0, 0, 4]} />
        <Bar dataKey="open" name="未完了" stackId="a" fill={ORANGE} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
