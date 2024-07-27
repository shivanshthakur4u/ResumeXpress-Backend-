import { Resume } from "../Models/Resume.Model.js";
import { User } from "../Models/User.Model.js";

export const createResume = async (req, res) => {
  try {
    const { title } = req.body;
    const { email } = req.user;
    const existingResume = await Resume.findOne({ title: title });

    if (existingResume) {
      return res
        .status(400)
        .json({ message: "Resume with this Title already exists" });
    }

    // Create a new resume
    const newResume = new Resume({ title: title, userEmail: email });
    await newResume.save();

    // Find the user and update their resumes array
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    user.resumes.push(newResume);
    await user.save();

    res.status(201).json({ title: newResume.title, _id: newResume?._id });
  } catch (err) {
    console.error("Error creating resume:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const getAllResume = async (req, res) => {
  try {
    const { email } = req.user;
    const { page, limit } = req.query;
    if ((page, limit)) {
      const pageNumber = parseInt(page, 10);
      const limitNumber = parseInt(limit, 10);
      const skipNumber = (pageNumber - 1) * limitNumber;
      const resumes = await Resume.find({ userEmail: email })
        .sort({ createdAt: -1 })
        .skip(skipNumber)
        .limit(limitNumber);
      const totalResumes = await Resume.countDocuments({ userEmail: email });
      res.status(200).json({
        success: true,
        resumes: resumes,
        totalPages: Math.ceil(totalResumes / limitNumber),
        currentPage: pageNumber,
        message: "Resumes fetched successfully",
      });
    } else {
      const resumes = await Resume.find({ userEmail: email });
      res.status(200).json({
        success: true,
        resumes: resumes,
        message: "Resumes fetched successfully",
      });
    }
  } catch (err) {
    console.error("Error getting all resumes:", err);
  }
};

export const updateResume = async (req, res) => {
  try {
    const { email } = req.user;
    const { id: resumeId } = req.params;
    // console.log("Resume Id:", resumeId);
    const updatedData = req.body;

    const resume = await Resume.findOne({ _id: resumeId, userEmail: email });
    if (!resume) return res.status(404).json({ message: "Invalid Resume Id" });

    // update resume
    Object.keys(updatedData).forEach((key) => {
      if (updatedData[key] !== undefined) {
        if (
          typeof updatedData[key] === "object" &&
          !Array.isArray(updatedData[key])
        ) {
          if (!resume[key]) {
            resume[key] = {};
          }
          // Update nested properties
          Object.keys(updatedData[key]).forEach((nestedKey) => {
            resume[key][nestedKey] = updatedData[key][nestedKey];
          });
        } else {
          resume[key] = updatedData[key];
        }
      }
    });
    await resume.save();
    res.status(200).json({
      success: true,
      updatedResume: resume,
      message: "Resume updated successfully",
    });
  } catch (err) {
    console.error("Error updating resume:", err);
  }
};

export const getResumeById = async (req, res) => {
  try {
    // const { email } = req.user;
    const { id: resumeId } = req.params;
    const resume = await Resume.findOne({ _id: resumeId });
    if (!resume) return res.status(404).json({ message: "Invalid Resume Id" });
    const { _id, title, userEmail, ...onlyresumeData } = resume.toObject();
    res.status(200).json({
      success: true,
      resume: { ...onlyresumeData },
      message: "Resume fetched successfully",
    });
  } catch (err) {
    res.status(501).json({
      success: false,
      message: "Internal Server Error ",
    });
  }
};

export const deleteResumeById = async (req, res) => {
  try {
    const { email } = req.user;
    const { id: resumeId } = req.params;

    // console.log('Deleting resume with ID:', resumeId);
    // console.log('For user with email:', email);

    const resume = await Resume.findOneAndDelete({
      _id: resumeId,
      userEmail: email,
    });

    if (!resume) {
      console.log("Resume not found");
      return res.status(404).json({
        success: false,
        message: "Invalid Resume Id",
      });
    }

    res.status(200).json({
      success: true,
      message: "Resume deleted successfully",
    });
  } catch (err) {
    console.error("Error deleting resume:", err);
    res.status(501).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};
