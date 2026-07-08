const getSupabaseClient = require('../config/db')

const authenticate = async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '')

  if (!token) {
    return res.status(401).json({ success: false, message: 'No token provided' })
  }

  try {
    const supabase = getSupabaseClient()

    const { data, error } = await supabase.auth.getUser(token)
    if (error) throw error

    const { data: profile, error: profileError } = await supabase
      .from('user_master')
      .select('"Role"')
      .eq('Auth User Id', data.user.id)
      .single()

    if (profileError) throw profileError

    if (!profile?.Role) {
      // FIX: no silent fallback to EMPLOYEE anymore — this was masking
      // real problems. If a role is missing, fail loudly instead.
      console.error("MIDDLEWARE: no role found for user", data.user.id)
      return res.status(403).json({ success: false, message: 'No role assigned to this account' })
    }

    req.user = {
      userId: data.user.id,
      email: data.user.email,
      // FIX: normalize casing to match what the rest of the app expects
      role: String(profile.Role).trim().toUpperCase()
    }

    next()
  } catch (err) {
    console.error("MIDDLEWARE AUTH ERROR:", err)
    res.status(401).json({ success: false, message: 'Invalid or expired token' })
  }
}

module.exports = { authenticate }