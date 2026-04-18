export type KnownContact = {
  name: string;
  email: string;
};

export function filterContacts(
  contacts: KnownContact[],
  query: string,
  limit = 8,
): KnownContact[] {
  const normalizedQuery = query.toLowerCase().trim();
  if (!normalizedQuery) {
    return contacts.slice(0, limit);
  }

  return contacts
    .filter((contact) => {
      return (
        contact.email.includes(normalizedQuery)
        || contact.name.toLowerCase().includes(normalizedQuery)
      );
    })
    .slice(0, limit);
}
