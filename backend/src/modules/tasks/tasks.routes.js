const router = require('express').Router()
const { authenticate } = require('../../middlewares/auth')
const { authorize } = require('../../middlewares/rbac')
const supabase = require('../../config/db')

router.use(authenticate)

// Get my tasks
router.get('/my', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0]

    const { data: allTasks } = await supabase
      .from('tasks')
      .select('*')
      .eq('assigned_to', req.user.userId)
      .order('created_at', { ascending: false })

    const todayTasks = allTasks?.filter(t =>
      t.due_date?.startsWith(today)
    ) || []

    res.json({
      success: true,
      data: {
        today: todayTasks,
        all: allTasks || [],
        stats: {
          totalToday: todayTasks.length,
          completedToday: todayTasks.filter(t => t.status === 'COMPLETED').length,
          pendingToday: todayTasks.filter(t => t.status !== 'COMPLETED').length,
          hoursToday: todayTasks.reduce((s, t) => s + Number(t.estimated_hours || 0), 0),
          totalAll: allTasks?.length || 0,
          completedAll: allTasks?.filter(t => t.status === 'COMPLETED').length || 0,
        }
      }
    })
  } catch (err) {
    res.status(400).json({ success: false, message: err.message })
  }
})

// Create task (manager only)
router.post('/', authorize('MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { title, description, assignedTo, estimatedHours, dueDate, priority } = req.body

    const { data, error } = await supabase.from('tasks').insert({
      title,
      description,
      assigned_to: assignedTo,
      created_by: req.user.userId,
      estimated_hours: estimatedHours,
      due_date: dueDate,
      priority: priority || 'MEDIUM',
      status: 'PENDING'
    }).select()

    if (error) throw error
    res.status(201).json({ success: true, data: data[0] })
  } catch (err) {
    res.status(400).json({ success: false, message: err.message })
  }
})

// Update task status
router.patch('/:id/status', async (req, res) => {
  try {
    const { status, actualHours } = req.body
    const { data, error } = await supabase
      .from('tasks')
      .update({
        status,
        actual_hours: actualHours,
        completed_at: status === 'COMPLETED' ? new Date().toISOString() : null
      })
      .eq('id', req.params.id)
      .select()

    if (error) throw error
    res.json({ success: true, data: data[0] })
  } catch (err) {
    res.status(400).json({ success: false, message: err.message })
  }
})

module.exports = router