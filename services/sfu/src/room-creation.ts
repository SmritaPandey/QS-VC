/** Share one router creation for simultaneous joins to the same room. */
export function coalesceRoomCreation<Room>(create: (id: string) => Promise<Room>) {
    const pending = new Map<string, Promise<Room>>();
    return (id: string): Promise<Room> => {
        const existing = pending.get(id);
        if (existing) return existing;
        const creation = create(id).finally(() => pending.delete(id));
        pending.set(id, creation);
        return creation;
    };
}
