import { processMontageCreation } from '../services/montageCreationService.js';

export const createMontage = (req, res) => {
  const user = req.user;

  // Immediately respond to the client to let them know the process has started.
  res.status(202).json({
    message: 'Montage creation process has started. This may take several minutes.',
  });

  // Trigger the long-running background process without awaiting it.
  setImmediate(() => {
    processMontageCreation({ user });
  });
};
