'use strict';

function positionKey({ row, column }) {
  return `${row}:${column}`;
}

function samePosition(first, second) {
  return first.row === second.row && first.column === second.column;
}

function lineKey(action) {
  const { origin, destination } = action;
  if (origin.row === destination.row) return `row:${origin.row}`;
  if (origin.column === destination.column) return `column:${origin.column}`;
  if (origin.row - origin.column === destination.row - destination.column) {
    return `diagonal-down:${origin.row - origin.column}`;
  }
  return `diagonal-up:${origin.row + origin.column}`;
}

function buildPath(action) {
  const rowDistance = action.destination.row - action.origin.row;
  const columnDistance = action.destination.column - action.origin.column;
  const distance = Math.max(Math.abs(rowDistance), Math.abs(columnDistance));
  const rowStep = Math.sign(rowDistance);
  const columnStep = Math.sign(columnDistance);
  const path = [];

  for (let step = 1; step <= distance; step += 1) {
    path.push({
      row: action.origin.row + rowStep * step,
      column: action.origin.column + columnStep * step,
    });
  }

  return path;
}

function isDestination(state, position) {
  return samePosition(state.action.destination, position);
}

function staticOccupant(board, movingIds, position) {
  const occupant = board.getCell(position.row, position.column);
  return occupant && !movingIds.has(occupant.id) ? occupant : null;
}

function canShareDestination(first, second, position) {
  return first.action.monster.ownerId !== second.action.monster.ownerId
    && isDestination(first, position)
    && isDestination(second, position);
}

function resolveLine(board, actions, movingIds) {
  const states = actions.map((action) => ({
    action,
    path: buildPath(action),
    pathIndex: 0,
    position: { ...action.origin },
    lastOpenPosition: { ...action.origin },
    finished: false,
  }));

  while (states.some((state) => !state.finished)) {
    const activeStates = states.filter((state) => !state.finished);
    const intentions = new Map(activeStates.map((state) => [
      state,
      state.path[state.pathIndex],
    ]));
    const blocked = new Set();

    for (const state of activeStates) {
      const nextPosition = intentions.get(state);
      const occupant = staticOccupant(board, movingIds, nextPosition);
      if (!occupant) continue;

      const isFriendly = occupant.ownerId === state.action.monster.ownerId;
      if ((isFriendly && isDestination(state, nextPosition))
        || (!isFriendly && !isDestination(state, nextPosition))) {
        blocked.add(state);
      }
    }

    const sharedIntentions = new Map();
    for (const state of activeStates) {
      const key = positionKey(intentions.get(state));
      if (!sharedIntentions.has(key)) sharedIntentions.set(key, []);
      sharedIntentions.get(key).push(state);
    }

    for (const contenders of sharedIntentions.values()) {
      if (contenders.length < 2) continue;
      const destinationContenders = contenders.filter((state) => (
        isDestination(state, intentions.get(state))
      ));

      if (destinationContenders.length >= 2) {
        for (const state of contenders) {
          if (!destinationContenders.includes(state)) blocked.add(state);
        }
      } else if (destinationContenders.length === 1) {
        for (const state of contenders) {
          if (state !== destinationContenders[0]) blocked.add(state);
        }
      } else {
        for (const state of contenders) blocked.add(state);
      }
    }

    for (let firstIndex = 0; firstIndex < activeStates.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < activeStates.length; secondIndex += 1) {
        const first = activeStates[firstIndex];
        const second = activeStates[secondIndex];
        const firstNext = intentions.get(first);
        const secondNext = intentions.get(second);
        const areEnemies = first.action.monster.ownerId !== second.action.monster.ownerId;

        if (areEnemies
          && samePosition(firstNext, second.position)
          && samePosition(secondNext, first.position)) {
          blocked.add(first);
          blocked.add(second);
        }
      }
    }

    let changed = true;
    while (changed) {
      changed = false;

      for (const state of activeStates) {
        if (blocked.has(state)) continue;
        const nextPosition = intentions.get(state);
        const occupants = states.filter((other) => (
          other !== state
          && other.action.monster.ownerId !== state.action.monster.ownerId
          && samePosition(other.position, nextPosition)
        ));

        for (const occupant of occupants) {
          if (canShareDestination(state, occupant, nextPosition)) continue;
          if (!intentions.has(occupant) || blocked.has(occupant)) {
            blocked.add(state);
            changed = true;
            break;
          }
        }
      }
    }

    for (const state of activeStates) {
      if (blocked.has(state)) {
        state.position = { ...state.lastOpenPosition };
        state.finished = true;
        continue;
      }

      const nextPosition = intentions.get(state);
      state.position = { ...nextPosition };
      state.pathIndex += 1;

      const occupant = staticOccupant(board, movingIds, nextPosition);
      if (!occupant || occupant.ownerId !== state.action.monster.ownerId) {
        state.lastOpenPosition = { ...nextPosition };
      }
      if (state.pathIndex === state.path.length) state.finished = true;
    }
  }

  return states;
}

function resolveMovementDestinations(board, actions) {
  const movingIds = new Set(actions.map((action) => action.monster.id));
  const groups = new Map();
  const destinations = new Map();

  for (const action of actions) {
    const key = lineKey(action);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(action);
  }

  for (const group of groups.values()) {
    for (const state of resolveLine(board, group, movingIds)) {
      destinations.set(state.action, { ...state.position });
    }
  }

  return destinations;
}

module.exports = { resolveMovementDestinations };
