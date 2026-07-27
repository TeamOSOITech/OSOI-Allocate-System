exports.listQcChecks = async (req, res) => {
  res.json({
    success: true,
    data: [],
  });
};

exports.createQcCheck = async (req, res) => {
  res.json({
    success: true,
    message: "QC Check created",
  });
};
