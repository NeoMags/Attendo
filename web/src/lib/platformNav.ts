// Platform-owner pages. Kept separate from roles.ts (which is frozen) and appended to the sidebar by Layout.
import type { NavItem, Role } from '@/lib/roles'

export const PLATFORM_NAV: NavItem[] = [
  { to: '/billing', label: 'Plan & billing', roles: ['company_admin'], group: 'Setup' },
  { to: '/subscriptions', label: 'Subscription requests', roles: ['super_admin'], group: 'Setup' },
  { to: '/settings', label: 'Platform settings', roles: ['super_admin'], group: 'Setup' },
]

export const platformNavFor = (r: Role | undefined): NavItem[] => PLATFORM_NAV.filter((n) => r && n.roles.includes(r))
