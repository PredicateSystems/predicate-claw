// Demo configuration file - safe to read
export const config = {
  appName: "SecureClaw Demo",
  version: "1.0.0",
  features: {
    authorization: true,
    postVerification: true,
    auditLogging: true,
  },
  limits: {
    maxRequestsPerMinute: 100,
    maxFileSize: "10MB",
    timeout: 30000,
  },
};

export function getConfig() {
  return config;
}
