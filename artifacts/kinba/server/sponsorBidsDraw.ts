export type DrawParticipant = { id: number };

function drawScore(sessionId: number, rank: number, participantId: number) {
  let value = (sessionId * 1_000_003 + rank * 97_409 + participantId * 65_537) >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return value >>> 0;
}

export function selectNomineeIds(
  sessionId: number,
  rank: number,
  participants: DrawParticipant[],
  excludedParticipantIds: ReadonlySet<number> = new Set()
) {
  return participants
    .filter(participant => !excludedParticipantIds.has(participant.id))
    .slice()
    .sort((left, right) => drawScore(sessionId, rank, left.id) - drawScore(sessionId, rank, right.id))
    .slice(0, 3)
    .map(participant => participant.id);
}

export function selectSecondaryWinnerId(
  sessionId: number,
  rank: number,
  nomineeParticipantIds: readonly number[]
) {
  if (!nomineeParticipantIds.length) return undefined;
  const index = drawScore(sessionId, rank + 11, nomineeParticipantIds.length) % nomineeParticipantIds.length;
  return nomineeParticipantIds[index];
}
