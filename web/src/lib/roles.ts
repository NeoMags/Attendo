export type Role = 'super_admin' | 'company_admin' | 'manager' | 'employee'

export const isAdmin = (r: Role | undefined) => r === 'super_admin' || r === 'company_admin'
/** Roles allowed into the dashboard at all. Employees use the mobile app only. */
export const canUseDashboard = (r: Role | undefined) => r === 'super_admin' || r === 'company_admin' || r === 'manager'

export interface NavItem { to: string; label: string; roles: Role[] }

export const NAV: NavItem[] = [
  { to: '/', label: 'Overview', roles: ['super_admin', 'company_admin', 'manager'] },
  { to: '/map', label: 'Live map', roles: ['super_admin', 'company_admin', 'manager'] },
  { to: '/routes', label: 'Route history', roles: ['super_admin', 'company_admin', 'manager'] },
  { to: '/employees', label: 'Employees', roles: ['super_admin', 'company_admin', 'manager'] },
  { to: '/attendance', label: 'Attendance', roles: ['super_admin', 'company_admin', 'manager'] },
  { to: '/analytics', label: 'Analytics', roles: ['super_admin', 'company_admin', 'manager'] },
  { to: '/reports', label: 'Reports', roles: ['super_admin', 'company_admin', 'manager'] },
  { to: '/devices', label: 'Device health', roles: ['super_admin', 'company_admin', 'manager'] },
  { to: '/geofences', label: 'Geofences', roles: ['super_admin', 'company_admin', 'manager'] },
  { to: '/team', label: 'Manager teams', roles: ['super_admin', 'company_admin'] },
  { to: '/setup', label: 'Departments & shifts', roles: ['super_admin', 'company_admin'] },
  { to: '/companies', label: 'Companies', roles: ['super_admin'] },
]

export const navFor = (r: Role | undefined) => NAV.filter((n) => r && n.roles.includes(r))
