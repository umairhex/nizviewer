'use strict';
var browserApi = typeof browser !== 'undefined' ? browser : chrome;
var DEFAULT_BADGE_PREFS = {
  datePosted: true,
  techStack: true,
  salary: true,
  shift: true,
  experience: true,
  workSetup: true,
  jobType: true,
  degree: true,
  benefits: true,
  perks: true,
  ageLimit: true,
  gender: true,

  theme: 'light',
  density: 'detailed',
  hideOldJobs: false,
  oldJobDays: 30,
  freshJobDays: 7,
  copyVisibleOnly: true,
  hiddenTechCategories: {},
};
