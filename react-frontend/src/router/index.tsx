import { lazy, type ComponentType } from 'react'
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router'
import App from '../App'
import Home from '../views/Home'
import { RouteGuard } from './guards'
import type { RouteHandle } from './meta'

/** A code-split page behind the route guard */
function page(load: () => Promise<{ default: ComponentType }>) {
  const Page = lazy(load)
  return (
    <RouteGuard>
      <Page />
    </RouteGuard>
  )
}

const handle = (value: RouteHandle) => value

// Home is eager (landing page); every other route is code-split and loaded on demand
const routes: RouteObject[] = [
  {
    element: <App />,
    children: [
      { path: '/', element: <RouteGuard><Home /></RouteGuard>, handle: handle({ name: 'home' }) },

      { path: '/signin', element: page(() => import('../views/auth/Login')), handle: handle({ name: 'signin', meta: { guestOnly: true, title: 'auth.signInTitle' } }) },
      { path: '/register', element: page(() => import('../views/auth/Register')), handle: handle({ name: 'register', meta: { guestOnly: true, title: 'auth.signUpTitle' } }) },
      { path: '/forgot', element: page(() => import('../views/auth/ForgotPassword')), handle: handle({ name: 'forgot', meta: { guestOnly: true, title: 'auth.forgotPasswordTitle' } }) },
      { path: '/reset-password', element: page(() => import('../views/auth/ResetPassword')), handle: handle({ name: 'reset-password', meta: { guestOnly: true, title: 'auth.resetPasswordTitle' } }) },
      // Notice + resend for signed-in users who still have to confirm their email
      {
        path: '/verify-email',
        element: page(() => import('../views/auth/VerifyEmail')),
        handle: handle({ name: 'verify-email', meta: { requiresAuth: true, allowUnverified: true, title: 'auth.verifyEmailTitle' } })
      },
      // Target of the emailed link; works signed in or not (the link's signature is the proof)
      {
        path: '/verify-email/:id/:hash',
        element: page(() => import('../views/auth/VerifyEmailConfirm')),
        handle: handle({ name: 'verify-email.confirm', meta: { title: 'auth.verifyingEmailTitle' } })
      },

      {
        path: '/clinic',
        handle: handle({ meta: { requiresAuth: true, tenant: 'doctor' } }),
        children: [
          { index: true, element: page(() => import('../themes/doctor/DoctorDashboard')), handle: handle({ name: 'clinic.dashboard', meta: { permission: 'appointments.view', title: 'nav.dashboard' } }) },
          { path: 'appointments', element: page(() => import('../themes/doctor/AppointmentsView')), handle: handle({ name: 'clinic.appointments', meta: { permission: 'appointments.view', title: 'nav.appointments' } }) },
          { path: 'patients', element: page(() => import('../themes/doctor/PatientsView')), handle: handle({ name: 'clinic.patients', meta: { permission: 'patients.view', title: 'nav.patients' } }) },
          { path: 'reports', element: page(() => import('../themes/doctor/ReportsView')), handle: handle({ name: 'clinic.reports', meta: { permission: 'reports.view', title: 'nav.reports' } }) }
        ]
      },

      {
        path: '/market',
        handle: handle({ meta: { requiresAuth: true, tenant: 'marketplace' } }),
        children: [
          {
            index: true,
            element: page(() => import('../themes/marketplace/MarketplaceDashboard')),
            handle: handle({ name: 'market.dashboard', meta: { permission: ['products.view', 'orders.view'], title: 'nav.dashboard' } })
          },
          { path: 'products', element: page(() => import('../themes/marketplace/ProductsView')), handle: handle({ name: 'market.products', meta: { permission: 'products.view', title: 'nav.products' } }) },
          { path: 'orders', element: page(() => import('../themes/marketplace/OrdersView')), handle: handle({ name: 'market.orders', meta: { permission: 'orders.view', title: 'nav.orders' } }) },
          { path: 'insights', element: page(() => import('../themes/marketplace/InsightsView')), handle: handle({ name: 'market.insights', meta: { permission: 'marketing.view', title: 'nav.marketing' } }) }
        ]
      },

      {
        path: '/admin',
        handle: handle({ meta: { requiresAuth: true } }),
        children: [
          { path: 'users', element: page(() => import('../views/admin/UsersView')), handle: handle({ name: 'admin.users', meta: { permission: 'users.view', title: 'nav.users' } }) },
          { path: 'roles', element: page(() => import('../views/admin/RolesView')), handle: handle({ name: 'admin.roles', meta: { permission: 'roles.view', title: 'nav.roles' } }) }
        ]
      },

      // Live chat, shared by every tenant theme; the open room lives in the query (?room=3)
      {
        path: '/chat',
        element: page(() => import('../views/chat/ChatView')),
        handle: handle({ name: 'chat', meta: { requiresAuth: true, permission: 'chat.view', title: 'nav.chat' } })
      },

      { path: '/dashboard', element: <Navigate to="/" replace />, handle: handle({ name: 'dashboard', meta: { requiresAuth: true } }) },
      {
        path: '/settings',
        element: page(() => import('../views/SettingsView')),
        handle: handle({ name: 'settings', meta: { requiresAuth: true, allowUnverified: true, title: 'common.settings' } })
      },
      { path: '/forbidden', element: page(() => import('../views/errors/ForbiddenView')), handle: handle({ name: 'forbidden', meta: { title: 'errors.forbiddenTitle' } }) },
      { path: '*', element: page(() => import('../views/errors/NotFoundView')), handle: handle({ name: 'not-found', meta: { title: 'errors.notFoundTitle' } }) }
    ]
  }
]

export const router = createBrowserRouter(routes)
