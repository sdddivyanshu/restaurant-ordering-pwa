"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiClientError } from "@/lib/client/api";
import { Badge, Button, ErrorNotice, Sheet, Skeleton } from "@/components/shared/ui";
import { Card, Check, PageHeader, SelectField, TextField } from "@/components/admin/kit";
import { formatDateTime } from "@/components/shared/status";

interface UserRow {
  id: string;
  email: string;
  name: string;
  roleKey: string;
  roleName: string;
  isActive: boolean;
  isDemo: boolean;
  lastLoginAt: string | null;
  extraPermissions: string[];
}
interface UsersResponse {
  users: UserRow[];
  roles: { key: string; label: string }[];
  permissions: string[];
}

export function UsersAdmin() {
  const [data, setData] = useState<UsersResponse | null>(null);
  const [edit, setEdit] = useState<Partial<UserRow> | null>(null);
  const load = useCallback(() => api<UsersResponse>("/api/v1/admin/users").then(setData), []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div className="space-y-5">
      <PageHeader title="Staff & roles" subtitle="Server-enforced role permissions, plus optional individual grants" actions={<Button variant="dark" onClick={() => setEdit({ roleKey: "SERVICE", isActive: true, extraPermissions: [] })}>+ Staff account</Button>} />
      {!data ? (
        <Skeleton className="h-64" />
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500">
              <tr><th className="py-2">Name</th><th>Role</th><th>Extra grants</th><th>Last sign-in</th><th /></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.users.map((u) => (
                <tr key={u.id} className={u.isActive ? "" : "opacity-50"}>
                  <td className="py-2">
                    <span className="font-semibold">{u.name}</span> {u.isDemo && <Badge tone="amber">demo</Badge>} {!u.isActive && <Badge tone="red">disabled</Badge>}
                    <span className="block text-xs text-slate-500">{u.email}</span>
                  </td>
                  <td>{u.roleName}</td>
                  <td className="text-xs">{u.extraPermissions.join(", ") || "—"}</td>
                  <td className="text-xs">{formatDateTime(u.lastLoginAt)}</td>
                  <td className="text-right"><Button size="sm" variant="secondary" onClick={() => setEdit(u)}>Edit</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {edit && data && <UserEditor initial={edit} roles={data.roles} permissions={data.permissions} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void load(); }} />}
    </div>
  );
}

function UserEditor({ initial, roles, permissions, onClose, onSaved }: { initial: Partial<UserRow>; roles: { key: string; label: string }[]; permissions: string[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(initial.name ?? "");
  const [email, setEmail] = useState(initial.email ?? "");
  const [roleKey, setRoleKey] = useState(initial.roleKey ?? "SERVICE");
  const [active, setActive] = useState(initial.isActive ?? true);
  const [password, setPassword] = useState("");
  const [extra, setExtra] = useState<string[]>(initial.extraPermissions ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (initial.id) await api(`/api/v1/admin/users/${initial.id}`, { method: "PATCH", body: { name, roleKey, isActive: active, extraPermissions: extra, ...(password && { password }) } });
      else await api("/api/v1/admin/users", { body: { name, email, roleKey, password, extraPermissions: extra } });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet open wide onClose={onClose} title={initial.id ? `Edit ${initial.name}` : "New staff account"} footer={<div className="flex justify-end"><Button variant="dark" loading={busy} onClick={save}>Save</Button></div>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Name" value={name} onChange={setName} />
        <TextField label="Email" type="email" value={email} onChange={setEmail} disabled={!!initial.id} />
        <SelectField label="Role" value={roleKey} onChange={setRoleKey} options={roles.map((r) => ({ value: r.key, label: r.label }))} />
        <TextField label={initial.id ? "New password (optional)" : "Password"} type="password" value={password} onChange={setPassword} hint="At least 12 characters with letters and numbers. Changing it signs the user out everywhere." autoComplete="new-password" />
        {initial.id && <Check label="Account active" checked={active} onChange={setActive} />}
      </div>
      <h3 className="mt-5 text-sm font-semibold">Extra permissions (beyond the role)</h3>
      <div className="mt-2 grid gap-1 sm:grid-cols-3">
        {permissions.map((p) => (
          <Check key={p} label={p} checked={extra.includes(p)} onChange={(v) => setExtra((s) => (v ? [...s, p] : s.filter((x) => x !== p)))} />
        ))}
      </div>
      {error && <div className="mt-3"><ErrorNotice message={error} /></div>}
    </Sheet>
  );
}
