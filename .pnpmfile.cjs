module.exports = {
  hooks: {
    readPackage(pkg) {
      if (pkg.dependencies && pkg.dependencies.qs) {
        pkg.dependencies.qs = '>=6.15.2';
      }
      if (pkg.devDependencies && pkg.devDependencies.qs) {
        pkg.devDependencies.qs = '>=6.15.2';
      }
      return pkg;
    }
  }
};
