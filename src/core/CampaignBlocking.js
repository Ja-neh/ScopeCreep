// Staged inside Level 3's open square, south of the fountain. These routes are
// sampled against Village.isOpenGround in the regression test.
export const AMBUSH_ROUTES = [
  { from: [-16, -549], to: [-11, -548] },
  { from: [16, -549], to: [11, -548] },
  { from: [-13, -557], to: [-9, -552] },
  { from: [13, -557], to: [9, -552] }
];
export const CAPTURE_POSITIONS = [[-6.6,-542],[-5.4,-542],[0,-542],[5.4,-542],[6.6,-542]];
export const SQUARE_CAMERAS = {
  arrival: { from: [12, 23, -536], to: [10, 20, -538], target: [0, 20, -546] },
  ambush: { from: [12, 5, -537], to: [10, 4.3, -538], target: [0, 1.5, -548] },
  capture: { from: [11, 3.4, -536], to: [10, 3, -537], target: [0, 1.3, -542] }
};
