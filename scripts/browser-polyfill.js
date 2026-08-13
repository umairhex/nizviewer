'use strict';
var browserApi = typeof browser !== 'undefined' ? browser : chrome;
var DEFAULT_BADGE_PREFS = {
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
  scanLimit: 5,
  scanInterval: 1500,
  theme: 'nizviewer',
};
