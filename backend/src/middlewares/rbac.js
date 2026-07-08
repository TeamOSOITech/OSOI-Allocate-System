const roleRank = { ADMIN: 3, MANAGER: 2, EMPLOYEE: 1 }

const authorize = (...roles) => (req, res, next) => {
  const userRank = roleRank[req.user?.role] || 0
  const minRequired = Math.min(...roles.map(r => roleRank[r]))

  if (userRank < minRequired) {
    return res.status(403).json({ success: false, message: 'Access denied' })
  }
  next()
}

module.exports = { authorize }