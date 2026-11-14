/**
 * English API wording (the port of lang/en/*.php plus the framework's
 * validation and password-reset lines). Keys are looked up as `<file>.<key>`.
 */
export default {
  auth: {
    failed: 'These credentials do not match our records.',
    password: 'The provided password is incorrect.',
    throttle: 'Too many login attempts. Please try again in :seconds seconds.'
  },

  passwords: {
    reset: 'Your password has been reset.',
    sent: 'We have emailed your password reset link.',
    throttled: 'Please wait before retrying.',
    token: 'This password reset token is invalid.',
    user: "We can't find a user with that email address."
  },

  messages: {
    unauthenticated: 'Your session has expired. Please sign in again.',
    forbidden: 'You do not have permission to perform this action.',
    not_found: 'The requested resource was not found.',
    route_not_found: 'The requested endpoint does not exist.',
    too_many_requests: 'Too many requests. Please slow down and try again shortly.',
    server_error: 'Something went wrong on our side. Please try again.',
    tenant_unavailable: 'Your organization is not available. Please contact support.',
    account_disabled: 'Your account has been disabled.',
    feature_unavailable: 'This feature is not available for your organization.',
    must_be_online: 'You must be online to check patients in.',
    invalid_transition: 'Cannot change status from :from to :to.',
    cannot_deactivate_self: 'You cannot deactivate your own account.',
    cannot_delete_self: 'You cannot delete your own account.',
    last_admin: 'At least one active administrator is required.',
    system_role_locked: 'System roles cannot be deleted or have their admin flag changed.',
    product_unavailable: 'One of the selected products is no longer available.',
    insufficient_stock: 'Only :stock units of :product are in stock.',
    mixed_currencies: 'All products in an order must use the same currency.',
    reset_link_sent: 'If that email exists, a reset link has been sent.',
    theme_unavailable: 'This application is not available.',
    theme_mismatch: 'This account belongs to a different application.',
    email_unverified: 'Please verify your email address to continue.',
    email_verified: 'Your email address has been verified.',
    email_already_verified: 'Your email address is already verified.',
    verification_link_sent: 'A new verification link has been sent to your email address.',
    verification_mail_failed: 'We could not send the verification email right now. Please try again in a few minutes.',
    verification_link_invalid: 'This verification link is invalid or has expired.',
    chat_muted: 'You are muted in this room.',
    chat_muted_until: 'You are muted in this room until :time.',
    chat_room_locked: 'This room is locked: only administrators can post.',
    chat_cannot_moderate: 'You cannot moderate this member.',
    chat_admin_only: 'Only administrators can lock or unlock rooms.',
    chat_default_room: 'The default room cannot be deleted.',
    chat_default_room_name: 'Global',
    chat_default_room_description: 'Everyone in the team: administrators, staff and members.',
    chat_announcements_room_name: 'Announcements',
    chat_announcements_room_description: 'News from the administrators.',
    registration_closed: 'Sign-ups are closed for this workspace. Please contact an administrator.',
    chat_admins_room_name: 'Admins',
    chat_admins_room_description: 'Only administrators can see this room.',
    chat_doctors_room_name: 'Doctors',
    chat_doctors_room_description: 'Doctors and administrators only.',
    chat_managers_room_name: 'Store managers',
    chat_managers_room_description: 'Store managers and administrators only.',
    chat_default_room_audience: 'The Global room is always open to everyone.',
    chat_audience_forbidden: 'You can only open rooms to everyone or to roles you hold yourself.',
    chat_audience_roles_required: 'Pick at least one role for this room.'
  },

  validation: {
    summary_one: ':message (and :count more error)',
    summary_other: ':message (and :count more errors)',
    required: 'The :attribute field is required.',
    required_with: 'The :attribute field is required when :values is present.',
    present: 'The :attribute field must be present.',
    string: 'The :attribute field must be a string.',
    integer: 'The :attribute field must be an integer.',
    boolean: 'The :attribute field must be true or false.',
    array: 'The :attribute field must be an array.',
    email: 'The :attribute field must be a valid email address.',
    alpha: 'The :attribute field must only contain letters.',
    in: 'The selected :attribute is invalid.',
    exists: 'The selected :attribute is invalid.',
    unique: 'The :attribute has already been taken.',
    distinct: 'The :attribute field has a duplicate value.',
    date: 'The :attribute field must be a valid date.',
    date_format: 'The :attribute field must match the format :format.',
    before_or_equal: 'The :attribute field must be a date before or equal to :date.',
    timezone: 'The :attribute field must be a valid timezone.',
    confirmed: 'The :attribute field confirmation does not match.',
    current_password: 'The password is incorrect.',
    max_string: 'The :attribute field must not be greater than :max characters.',
    max_numeric: 'The :attribute field must not be greater than :max.',
    max_array: 'The :attribute field must not have more than :max items.',
    min_string: 'The :attribute field must be at least :min characters.',
    min_numeric: 'The :attribute field must be at least :min.',
    min_array: 'The :attribute field must have at least :min items.',
    size_string: 'The :attribute field must be :size characters.',
    json: 'The request body is not valid JSON.'
  },

  mail: {
    common: {
      greeting: 'Hi :name,',
      expires: 'For your security, this link expires in :time.',
      fallback: 'Button not working? Copy and paste this link into your browser:',
      footer: 'You are receiving this email because of your account at :organization.',
      signature: 'The :organization team'
    },

    'verify-email': {
      default: {
        subject: 'Confirm your email address',
        eyebrow: 'One more step',
        title: 'Confirm your email address',
        intro: 'Thanks for joining :organization. Please confirm your email address to finish setting up your account.',
        cta: 'Confirm my email',
        ignore: 'If you did not create this account, you can safely ignore this email.'
      },
      doctor: {
        subject: 'Confirm your email to open :organization',
        eyebrow: 'Clinic workspace',
        title: 'Welcome to :organization',
        intro: 'You are one step away from your clinic workspace. Confirm your email address so we know it is really you.',
        highlights_title: 'Once you are in, you can:',
        highlights: [
          'Book and manage appointments for the whole team',
          'Keep patient records safe in one place',
          'Check patients in and follow today’s queue live'
        ]
      },
      marketplace: {
        subject: 'Activate your :organization store account',
        eyebrow: 'Store workspace',
        title: 'Your store is almost ready',
        intro: 'Confirm your email address to start selling with :organization.',
        cta: 'Activate my account',
        highlights_title: 'What is waiting for you:',
        highlights: [
          'Add products and keep stock under control',
          'Take orders and follow them to delivery',
          'See what sells best with live insights'
        ]
      }
    },

    'reset-password': {
      default: {
        subject: 'Reset your password',
        eyebrow: 'Account security',
        title: 'Reset your password',
        intro: 'We received a request to reset the password of your :organization account.',
        cta: 'Choose a new password',
        ignore: 'If you did not ask for this, no action is needed: your password stays the same.'
      },
      doctor: {
        subject: 'Reset your :organization password',
        eyebrow: 'Clinic workspace',
        intro: 'We received a request to reset the password of your account at :organization. Choose a new one to get back to your patients.'
      },
      marketplace: {
        subject: 'Reset your :organization store password',
        eyebrow: 'Store workspace',
        title: 'Let’s get you back to your store',
        intro: 'We received a request to reset the password of your :organization store account.'
      }
    }
  },

  /** Durations for "expires in", e.g. "1 day", "1 hour 30 minutes" */
  durations: {
    week: [':count week', ':count weeks'],
    day: [':count day', ':count days'],
    hour: [':count hour', ':count hours'],
    minute: [':count minute', ':count minutes']
  }
}
