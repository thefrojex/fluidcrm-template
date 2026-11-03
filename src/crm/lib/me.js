// The signed-in person's display name. Their board is private, so "a person" as an event owner
// is always them; the UI shows their name where the original design showed "Abhinav".
let me = 'Me'
let myId = null
export const setMe = (name, personId = null) => {
  me = name || 'Me'
  myId = personId
}
export const getMe = () => me
// Their id in the workspace's people (core.people), for reminders meant for them
export const getMyId = () => myId
