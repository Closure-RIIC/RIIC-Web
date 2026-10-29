// tinyglobby expands literal directories recursively; exclude descendants so only
// these two application configs become projects, never generated/public folders.
export default { projects: ["apps/arknights", "apps/endfield", "!apps/*/*"] };
