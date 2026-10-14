import { adminPageClass, AdminPageHeader } from "../admin-page";
import { AdminUserManagement } from "./users-client";


export default function AdminUsersPage() {
  return (
    <main id="admin-content" className={adminPageClass}>
      <AdminPageHeader title="users" description="usersHint" />
      <AdminUserManagement />
    </main>
  );
}
