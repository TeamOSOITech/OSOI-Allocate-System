const teamService = require("./teams.service");

const getAllTeams = async (req, res) => {
  try {
    const teams = await teamService.getAllTeams(req.user.organizationId);
    return res.status(200).json({ success: true, data: teams });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getTeamById = async (req, res) => {
  try {
    const { id } = req.params;
    const team = await teamService.getTeamById(id, req.user.organizationId);

    if (!team) {
      return res
        .status(404)
        .json({ success: false, message: "Team not found" });
    }

    return res.status(200).json({ success: true, data: team });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const createTeam = async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || !name.toString().trim()) {
      return res
        .status(400)
        .json({ success: false, message: "name is required" });
    }

    const team = await teamService.createTeam(
      { name: name.toString().trim() },
      req.user.organizationId,
    );

    return res.status(201).json({ success: true, data: team });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const updateTeam = async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!name || !name.toString().trim()) {
      return res
        .status(400)
        .json({ success: false, message: "name is required" });
    }

    const team = await teamService.updateTeam(
      id,
      { name: name.toString().trim() },
      req.user.organizationId,
    );

    return res.status(200).json({ success: true, data: team });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const deleteTeam = async (req, res) => {
  try {
    const { id } = req.params;
    const team = await teamService.deleteTeam(id, req.user.organizationId);

    return res.status(200).json({ success: true, data: team });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getAllTeams,
  getTeamById,
  createTeam,
  updateTeam,
  deleteTeam,
};
