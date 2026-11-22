export type Role = 'super_admin' | 'company_admin' | 'manager' | 'employee'

export const isAdmin = (r: Role | undefined) => r === 'super_admin' || r === 'company_admin'
/** Roles allowed into the dashboard at all. Employees use the mobile app only. */
export const canUseDashboard = (r: Role | undefined) => r === 'super_admin' || r === 'company_admin' || r === 'manager'

export type NavGroup = 'Monitor' | 'People' | 'Setup'
export interface NavItem { to: string; label: string; roles: Role[]; group: NavGroup }

export const NAV: NavItem[] = [
  { to: '/', label: 'Overview', roles: ['super_admin', 'company_admin', 'manager'], group: 'Monitor' },
  { to: '/map', label: 'Live map', roles: ['super_admin', 'company_admin', 'manager'], group: 'Monitor' },
  { to: '/routes', label: 'Route history', roles: ['super_admin', 'company_admin', 'manager'], group: 'Monitor' },
  { to: '/schedule', label: 'Field schedule', roles: ['super_admin', 'company_admin', 'manager'], group: 'Monitor' },
  { to: '/alerts', label: 'Geofence alerts', roles: ['super_admin', 'company_admin', 'manager'], group: 'Monitor' },
  { to: '/devices', label: 'Device health', roles: ['super_admin', 'company_admin', 'manager'], group: 'Monitor' },
  { to: '/analytics', label: 'Analytics', roles: ['super_admin', 'company_admin', 'manager'], group: 'Monitor' },
  { to: '/employees', label: 'Employees', roles: ['super_admin', 'company_admin', 'manager'], group: 'People' },
  { to: '/attendance', label: 'Attendance', roles: ['super_admin', 'company_admin', 'manager'], group: 'People' },
  { to: '/tasks', label: 'Tasks', roles: ['super_admin', 'company_admin', 'manager'], group: 'People' },
  { to: '/leave', label: 'Leave', roles: ['super_admin', 'company_admin', 'manager'], group: 'People' },
  { to: '/calendar', label: 'Attendance calendar', roles: ['super_admin', 'company_admin', 'manager'], group: 'People' },
  { to: '/reports', label: 'Reports', roles: ['super_admin', 'company_admin', 'manager'], group: 'People' },
  { to: '/team', label: 'Manager teams', roles: ['super_admin', 'company_admin'], group: 'People' },
  { to: '/geofences', label: 'Geofences', roles: ['super_admin', 'company_admin', 'manager'], group: 'Setup' },
  { to: '/setup', label: 'Departments & shifts', roles: ['super_admin', 'company_admin'], group: 'Setup' },
  { to: '/companies', label: 'Companies', roles: ['super_admin'], group: 'Setup' },
]

export const navFor = (r: Role | undefined) => NAV.filter((n) => r && n.roles.includes(r))

export const NAV_GROUPS: NavGroup[] = ['Monitor', 'People', 'Setup']
