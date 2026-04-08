export function collidesAabb(getVoxelAtWorld, centerX, centerY, centerZ, playerHalfWidth, playerHalfHeight) {
  const epsilon = 1e-4;
  const minX = Math.floor((centerX - playerHalfWidth) + epsilon);
  const maxX = Math.floor((centerX + playerHalfWidth) - epsilon);
  const minY = Math.floor((centerY - playerHalfHeight) + epsilon);
  const maxY = Math.floor((centerY + playerHalfHeight) - epsilon);
  const minZ = Math.floor((centerZ - playerHalfWidth) + epsilon);
  const maxZ = Math.floor((centerZ + playerHalfWidth) - epsilon);

  for (let y = minY; y <= maxY; y++) {
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        if (getVoxelAtWorld(x, y, z) > 0) return true;
      }
    }
  }
  return false;
}

export function moveAlongAxis(getVoxelAtWorld, position, axis, delta, playerHalfWidth, playerHalfHeight) {
  if (Math.abs(delta) < 1e-7) return false;

  const maxStep = 0.2;
  const steps = Math.max(1, Math.ceil(Math.abs(delta) / maxStep));
  const stepDelta = delta / steps;

  for (let i = 0; i < steps; i++) {
    const nextX = axis === 'x' ? position.x + stepDelta : position.x;
    const nextY = axis === 'y' ? position.y + stepDelta : position.y;
    const nextZ = axis === 'z' ? position.z + stepDelta : position.z;
    if (collidesAabb(getVoxelAtWorld, nextX, nextY, nextZ, playerHalfWidth, playerHalfHeight)) return true;
    position.x = nextX;
    position.y = nextY;
    position.z = nextZ;
  }

  return false;
}

export function tryMoveWithStepUp(getVoxelAtWorld, position, axis, delta, playerHalfWidth, playerHalfHeight) {
  if (Math.abs(delta) < 1e-7) return false;

  const steppedPosition = { x: position.x, y: position.y + 1, z: position.z };
  if (collidesAabb(getVoxelAtWorld, steppedPosition.x, steppedPosition.y, steppedPosition.z, playerHalfWidth, playerHalfHeight)) {
    return false;
  }

  const blocked = moveAlongAxis(getVoxelAtWorld, steppedPosition, axis, delta, playerHalfWidth, playerHalfHeight);
  if (blocked) return false;

  position.x = steppedPosition.x;
  position.y = steppedPosition.y;
  position.z = steppedPosition.z;
  return true;
}

export function moveWithStepUp(getVoxelAtWorld, position, axis, delta, playerHalfWidth, playerHalfHeight) {
  const startPosition = { x: position.x, y: position.y, z: position.z };
  const blocked = moveAlongAxis(getVoxelAtWorld, position, axis, delta, playerHalfWidth, playerHalfHeight);
  if (!blocked) return false;

  position.x = startPosition.x;
  position.y = startPosition.y;
  position.z = startPosition.z;

  const steppedPosition = { x: startPosition.x, y: startPosition.y + 1, z: startPosition.z };
  if (collidesAabb(getVoxelAtWorld, steppedPosition.x, steppedPosition.y, steppedPosition.z, playerHalfWidth, playerHalfHeight)) {
    return true;
  }

  const stepBlocked = moveAlongAxis(getVoxelAtWorld, steppedPosition, axis, delta, playerHalfWidth, playerHalfHeight);
  if (stepBlocked) {
    position.x = startPosition.x;
    position.y = startPosition.y;
    position.z = startPosition.z;
    return true;
  }

  position.x = steppedPosition.x;
  position.y = steppedPosition.y;
  position.z = steppedPosition.z;
  return false;
}

export function resolvePenetrationUp(getVoxelAtWorld, position, maxLift, playerHalfWidth, playerHalfHeight) {
  if (!collidesAabb(getVoxelAtWorld, position.x, position.y, position.z, playerHalfWidth, playerHalfHeight)) return true;
  for (let i = 0; i < maxLift; i++) {
    position.y += 1;
    if (!collidesAabb(getVoxelAtWorld, position.x, position.y, position.z, playerHalfWidth, playerHalfHeight)) return true;
  }
  return false;
}
