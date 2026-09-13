import dotenv from "dotenv";
dotenv.config();

export const USERS = {
  ildus: {
    id: "ildus",
    name: "Ильдус",
    clientId: process.env.ILDUS_CLIENT_ID || "",
    apiKey: process.env.ILDUS_API_KEY || "",
  },
  ilnur: {
    id: "ilnur",
    name: "Ильнур",
    clientId: process.env.ILNUR_CLIENT_ID || "",
    apiKey: process.env.ILNUR_API_KEY || "",
  },
};

export function getUser(userId) {
  const user = USERS[userId];
  if (!user) throw new Error(`Неизвестный пользователь: ${userId}`);
  if (!user.clientId || !user.apiKey) {
    throw new Error(
      `Для пользователя «${user.name}» не заданы Client-Id или Api-Key`
    );
  }
  return user;
}