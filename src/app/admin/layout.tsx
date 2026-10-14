import { AdminShell } from "./admin-shell";
export default function AdminLayout({ children, isAdmin, name }: Readonly<{ children: React.ReactNode; isAdmin: boolean; name: string }>) {
  return <AdminShell isAdmin={isAdmin} name={name}>{children}</AdminShell>;
}
