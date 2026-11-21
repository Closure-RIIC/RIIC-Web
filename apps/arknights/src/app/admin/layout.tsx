import { AdminShell } from "./admin-shell";
export default function AdminLayout({ children, isAdmin, isSuperAdmin = false, name }: Readonly<{ children: React.ReactNode; isAdmin: boolean; isSuperAdmin?: boolean; name: string }>) {
  return <AdminShell isAdmin={isAdmin} isSuperAdmin={isSuperAdmin} name={name}>{children}</AdminShell>;
}
